"""Objection ledger: the shared state the four agents argue over.

Every objection raised by the Critic (or by a deterministic verifier) lives here with a status, so the
pipeline can decide *from facts* whether another correction round is worth it, and the final report can
show what was raised, what was changed, what was disputed and what is still unresolved.

Statuses:  open -> (Fixer accepts) -> resolved | (Fixer rejects) -> disputed -> contested | withdrawn
"""
import difflib

SERIOUS = {"blocking", "major"}  # only these can trigger a Fixer round; minor items are reported, never "fixed"
ACTIONABLE = {"open", "disputed"}  # a Fixer round could still change the outcome
MAX_DISPUTES = 2  # Fixer may rebut an objection once; if the Critic still upholds it, it becomes "contested"


def _norm(text: str) -> str:
    return "\n".join(line.rstrip() for line in (text or "").strip().splitlines())


def diff_stats(old: str, new: str) -> dict:
    """Real line-level diff between two answers (not an LLM's description of what it changed)."""
    lines = list(difflib.unified_diff(_norm(old).splitlines(), _norm(new).splitlines(), lineterm="", n=0))
    added = [l[1:] for l in lines if l.startswith("+") and not l.startswith("+++")]
    removed = [l[1:] for l in lines if l.startswith("-") and not l.startswith("---")]
    samples = [f"- {l[:160]}" for l in removed[:4]] + [f"+ {l[:160]}" for l in added[:4]]
    return {"added": len(added), "removed": len(removed), "unchanged": _norm(old) == _norm(new), "samples": samples}


class Ledger:
    def __init__(self):
        self.items: dict[str, dict] = {}
        self._seq = 0

    # ------------------------------------------------------------------ adding objections
    def _new(self, **fields) -> dict:
        item = {"status": "open", "disputes": 0, "fixer_action": None, "fixer_reason": "", "change": "",
                "resolution": "", "introduced_by_fix": False, **fields}
        self.items[item["id"]] = item
        return item

    def sync_verifier(self, findings: list[dict], rnd: int) -> None:
        """Deterministic findings are ground truth: they stay open exactly while the verifier still fails."""
        present = {f["key"] for f in findings}
        for f in findings:
            existing = self.items.get(f["key"])
            if existing:
                if existing["status"] in ("resolved", "withdrawn"):  # came back after a fix = regression
                    existing.update(status="open", resolution="", introduced_by_fix=True, round=rnd)
                continue
            self._new(id=f["key"], round=rnd, source="verifier", severity="blocking", type=f["type"], target="answer",
                      problem=f["problem"], evidence=f["evidence"], suggested_fix=f.get("suggested_fix", ""))
        for item in self.items.values():
            if item["source"] == "verifier" and item["id"] not in present and item["status"] not in ("resolved", "withdrawn"):
                item.update(status="resolved", resolution="Verifier re-run: the check now passes.")

    def apply_rulings(self, rulings: list[dict], rnd: int) -> None:
        """Critic's verdict on objections it saw before: resolved / upheld / withdrawn."""
        ruled = set()
        for r in rulings:
            item = self.items.get(str(r.get("id")))
            if not item or item["source"] != "critic":
                continue
            ruled.add(item["id"])
            ruling, reason = str(r.get("ruling", "")).lower(), str(r.get("reason", "")).strip()
            if ruling == "resolved":
                item.update(status="resolved", resolution=reason or "Critic confirmed the fix.")
            elif ruling == "withdrawn":
                item.update(status="withdrawn", resolution=reason or "Critic accepted the Fixer's rebuttal.")
            else:  # upheld
                item.update(status="open", resolution="", critic_note=reason)
        # Accepted fixes the Critic did not re-raise are treated as resolved, and labelled as such.
        for item in self.items.values():
            if (item["source"] == "critic" and item["id"] not in ruled and item["status"] == "open"
                    and item["fixer_action"] in ("accept", "partial") and item["round"] < rnd):
                item.update(status="resolved", resolution="Not re-raised by the Critic after the fix.")

    def add_critic_objections(self, objections: list[dict], rnd: int) -> list[dict]:
        added = []
        for o in objections:
            self._seq += 1
            added.append(self._new(id=f"O{self._seq}", round=rnd, source="critic", severity=o["severity"],
                                   type=o["type"], target=o["target"], problem=o["problem"], evidence=o["evidence"],
                                   suggested_fix=o.get("suggested_fix", ""),
                                   introduced_by_fix=bool(o.get("introduced_by_fix"))))
        return added

    def apply_fixer(self, responses: list[dict]) -> None:
        for r in responses:
            item = self.items.get(r["id"])
            if not item:
                continue
            action = r["action"]
            if action == "reject" and item["source"] == "verifier":
                action = "accept"  # ground truth cannot be argued away; it stays open until the verifier passes
                r = {**r, "reason": "(rejection ignored: deterministic check) " + r.get("reason", "")}
            item.update(fixer_action=action, fixer_reason=r.get("reason", ""), change=r.get("change", ""))
            if action == "reject":
                item["disputes"] += 1
                item["status"] = "contested" if item["disputes"] >= MAX_DISPUTES else "disputed"

    # ------------------------------------------------------------------ queries
    def actionable(self) -> list[dict]:
        return [i for i in self.items.values() if i["severity"] in SERIOUS and i["status"] in ACTIONABLE]

    def unresolved_serious(self) -> list[dict]:
        return [i for i in self.items.values() if i["severity"] in SERIOUS and i["status"] in ACTIONABLE | {"contested"}]

    def counts(self) -> tuple[int, int]:
        """(issues_found, issues_fixed): serious objections that were real (not withdrawn) and how many got resolved."""
        real = [i for i in self.items.values() if i["severity"] in SERIOUS and i["status"] != "withdrawn"]
        return len(real), sum(1 for i in real if i["status"] == "resolved")

    def prompt_view(self) -> list[dict]:
        """Compact view of earlier objections for the Critic's next round (keeps the prompt small)."""
        return [{"id": i["id"], "severity": i["severity"], "problem": i["problem"],
                 "fixer_action": i["fixer_action"], "fixer_reason": i["fixer_reason"], "change": i["change"]}
                for i in self.items.values() if i["source"] == "critic" and i["status"] in ACTIONABLE and i["fixer_action"]]

    def export(self) -> list[dict]:
        keep = ("id", "round", "source", "severity", "type", "target", "problem", "evidence", "suggested_fix",
                "status", "fixer_action", "fixer_reason", "change", "resolution", "disputes", "introduced_by_fix")
        return [{k: i.get(k) for k in keep} for i in self.items.values()]


def confidence(ledger: Ledger, approved: bool, checks_shown: int, risks: list[str], unreviewed: bool) -> tuple[str, str]:
    """Deterministic confidence from the final state, never a number the model asserts about itself."""
    if unreviewed:
        return "low", "Only deterministic checks ran; no model reviewed this answer (offline mock engine)."
    serious = ledger.unresolved_serious()
    if serious:
        return "low", f"{len(serious)} serious objection(s) still unresolved."
    if not approved:
        return "low", "The Critic did not approve the final answer."
    if checks_shown == 0:
        return "medium", "Approved, but the Critic did not show what it checked."
    if risks:
        return "medium", f"Approved, with {len(risks)} unresolved risk(s) listed below."
    return "high", "Approved by the Critic with shown checks, deterministic checks pass, no open risks."
