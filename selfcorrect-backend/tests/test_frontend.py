"""The web interface is served by the backend and every page's files exist and are wired up."""
import re
from pathlib import Path

FRONT = Path(__file__).resolve().parent.parent / "frontend"
PAGES = ["index", "login", "register", "history", "evaluation", "profile", "about", "404"]


def test_root_redirects_to_app(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/app/index.html"


def test_every_page_is_served(client):
    for page in PAGES[:-1]:
        r = client.get(f"/app/{page}.html")
        assert r.status_code == 200 and "<title>" in r.text, page


def test_unknown_page_shows_404_page(client):
    r = client.get("/app/does-not-exist.html")
    assert r.status_code == 404 and "wandered off" in r.text


def test_local_assets_exist_and_pages_register_scripts():
    registered = set(re.findall(r"window\.Pages\.(\w+)\s*=", "".join(p.read_text(encoding="utf-8") for p in (FRONT / "js").glob("*.js"))))
    for page in PAGES:
        html = (FRONT / f"{page}.html").read_text(encoding="utf-8")
        for ref in re.findall(r'(?:src|href)="((?:js|css)/[^"]+|icon\.svg)"', html):
            assert (FRONT / ref).is_file(), f"{page}.html references missing {ref}"
        name = re.search(r'data-page="(\w+)"', html).group(1)
        assert name == "notfound" or name in registered, f"{page}.html has no script registering Pages.{name}"
        for target in re.findall(r'href="([\w-]+\.html)"', html):
            assert (FRONT / target).is_file(), f"{page}.html links to missing {target}"


def test_frontend_matches_api_error_shape(client):
    """The UI reads {error:{message,details:[{field,message}]}}, which is what the API returns."""
    body = client.post("/api/auth/register", json={"email": "bad", "full_name": "A", "password": "x"}).json()
    assert {d["field"] for d in body["error"]["details"]} >= {"email", "full_name", "password"}
