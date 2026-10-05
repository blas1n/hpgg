"""Comments on the weekly report and the hero pages (owner 2026-10-05): anonymous (nickname +
password, like a DC/Arca 유동닉), hidden after reports from three addresses, deleted by the owner
from the Mac mini. No account yet; a later Battle.net login fills `account_id`."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.comments.admin import main as admin
from server.config import Settings
from tests.server.conftest import Clock, FakeHP

URL = "/v1/comments"
T = "weekly:2026-w40"
A = {"CF-Connecting-IP": "203.0.113.20"}
B = {"CF-Connecting-IP": "203.0.113.21"}
C = {"CF-Connecting-IP": "203.0.113.22"}


@pytest.fixture
def client(settings: Settings, fake_hp: FakeHP, clock: Clock) -> Iterator[TestClient]:
    app = create_app(settings, hp_transport=fake_hp.transport, clock=clock, privacy_poll=False)
    with TestClient(app) as c:
        yield c


def post(c: TestClient, headers: dict[str, str] = A, **kw: str) -> object:
    body = {
        "thread": T,
        "nickname": "잘아타스장인",
        "password": "1234",
        "body": "잘아타스 체감보다 더 셈",
        **kw,
    }
    return c.post(URL, json=body, headers=headers)


def test_a_comment_is_written_and_read_back(client: TestClient) -> None:
    r = post(client)
    assert r.status_code == 201  # type: ignore[attr-defined]
    got = client.get(URL, params={"thread": T}).json()
    assert got["count"] == 1
    c = got["comments"][0]
    assert (c["nickname"], c["body"]) == ("잘아타스장인", "잘아타스 체감보다 더 셈")
    assert (
        len(c["tag"]) == 4
    )  # tells two people with one nickname apart, without showing an address
    assert "password" not in c and "ip" not in str(c)
    # another thread is another thread
    assert client.get(URL, params={"thread": "hero:valla"}).json() == {"count": 0, "comments": []}


def test_the_same_address_has_the_same_tag_and_another_address_another(client: TestClient) -> None:
    post(client, A)
    post(client, A, body="두 번째")
    post(client, B, body="다른 사람")
    tags = [c["tag"] for c in client.get(URL, params={"thread": T}).json()["comments"]]
    assert tags[0] == tags[1] != tags[2]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("thread", "admin:all"),  # only the threads the site has
        ("nickname", ""),
        ("nickname", "x" * 17),
        ("nickname", "운영자"),  # no posing as the site
        ("password", "123"),
        ("body", "   "),
        ("body", "가" * 501),
        ("body", "여기로 오세요 https://spam.example"),  # no links
        ("body", "www.spam.example"),
    ],
)
def test_bad_input_is_refused(client: TestClient, field: str, value: str) -> None:
    r = post(client, **{field: value})
    assert r.status_code == 422  # type: ignore[attr-defined]
    assert client.get(URL, params={"thread": T}).json()["count"] == 0


def test_a_filled_honeypot_is_a_bot(client: TestClient) -> None:
    r = post(client, website="http://bot.example")
    assert r.status_code == 422  # type: ignore[attr-defined]


def test_the_author_deletes_with_the_password(client: TestClient) -> None:
    post(client)
    cid = client.get(URL, params={"thread": T}).json()["comments"][0]["id"]
    assert (
        client.post(f"{URL}/{cid}/delete", json={"password": "wrong"}, headers=A).status_code == 403
    )
    assert (
        client.post(f"{URL}/{cid}/delete", json={"password": "1234"}, headers=B).status_code == 204
    )
    assert client.get(URL, params={"thread": T}).json()["count"] == 0


def test_three_addresses_reporting_hide_a_comment_one_address_counts_once(
    client: TestClient,
) -> None:
    post(client)
    cid = client.get(URL, params={"thread": T}).json()["comments"][0]["id"]
    for _ in range(3):
        assert client.post(f"{URL}/{cid}/report", headers=A).status_code == 204
    assert client.get(URL, params={"thread": T}).json()["count"] == 1
    client.post(f"{URL}/{cid}/report", headers=B)
    client.post(f"{URL}/{cid}/report", headers=C)
    assert client.get(URL, params={"thread": T}).json()["count"] == 0


def test_one_address_writes_a_few_comments_at_a_time(
    client: TestClient, settings: Settings, clock: Clock
) -> None:
    for i in range(settings.comment_posts_per_window):
        assert post(client, body=f"댓글 {i}").status_code == 201  # type: ignore[attr-defined]
    r = post(client, body="도배")
    assert r.status_code == 429  # type: ignore[attr-defined]
    assert post(client, B, body="다른 사람은 됨").status_code == 201  # type: ignore[attr-defined]
    clock.now += settings.comment_window_seconds + 1
    assert post(client, body="시간이 지나면 됨").status_code == 201  # type: ignore[attr-defined]


def test_no_address_and_no_password_is_stored(client: TestClient, settings: Settings) -> None:
    post(client)
    with sqlite3.connect(settings.db_path) as db:
        rows = db.execute("select * from comments").fetchall()
        dump = repr(rows)
    assert "203.0.113.20" not in dump
    assert "1234" not in dump.replace("1234567", "")  # the hash, not the password


def test_the_browser_may_post(client: TestClient) -> None:
    pre = client.options(
        URL,
        headers={
            "Origin": "https://hpgg.win",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert pre.status_code == 200
    assert "POST" in pre.headers["access-control-allow-methods"]


def test_the_owner_hides_restores_and_deletes_from_the_mac_mini(
    client: TestClient, settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    post(client)
    cid = client.get(URL, params={"thread": T}).json()["comments"][0]["id"]
    db = str(settings.db_path)
    assert admin(["--db", db, "list"]) == 0
    assert "잘아타스 체감보다 더 셈" in capsys.readouterr().out
    assert admin(["--db", db, "hide", str(cid)]) == 0
    assert client.get(URL, params={"thread": T}).json()["count"] == 0
    assert admin(["--db", db, "restore", str(cid)]) == 0
    assert client.get(URL, params={"thread": T}).json()["count"] == 1
    assert admin(["--db", db, "delete", str(cid)]) == 0
    assert client.get(URL, params={"thread": T}).json()["count"] == 0
