# 설계: Battle.net 로그인 + 회원 전용 개인화 밴픽

작성 2026-10-30 · 상태: **구현됨 (#194 · #195 · #197 · #200, 공개 #201)** — 아래 C·D는 오너 결정으로 바뀐 최종 모양 · 관련 이슈: #28 계정, #7 커뮤니티, #109 밴픽

## 결정 (오너, 2026-10-29~30)

- 밴픽 추천은 **본인 영웅풀 안에서** 나와야 의미가 있다. 개인화는 **회원 전용**이다. 비회원은 지금 그대로 쓴다.
- 회원 전용으로 하는 이유는 두 가지다. 회원가입까지 한 사람은 충성 사용자라 나중에 구독제나 자체 데이터로 바뀌어도 따라올 가능성이 크다. 또 회원가입이 HP 개인 조회 한도(상세 전적과 영웅별 기록, 주 500)를 걸러 주는 1차 필터가 된다.
- 계정은 이후 커뮤니티 기능(#7, 디스코드 연동 기획 `DESIGN-2026-10-28-discord-party.md`)과 연결한다.
- **자체 리플레이 전환은 보류한다.** 사용자가 지금의 2배(주간 페이지 방문 약 4,800)가 되면 다시 검토한다. 그때 다시 볼 것:
  - 개인 조회 한도. Developer $25면 주 5,000이고, 그 위는 HP와 협상해야 한다.
  - HP 약관 §3. HP 데이터를 유료화하려면 서면 동의가 필요하고, 우리가 모은 리플레이와 HP 데이터를 섞으면 안 된다.
  - 표본. 지금 수준을 자체 데이터로 채우려면 업로더 사용자 100~300명이 필요하다.

## 범위

### A. 로그인 (server)
- `server/accounts/`: 라우터, 테이블, Alembic 리비전. 기존 FastAPI 앱 안에 둔다.
- 인증은 Battle.net OAuth authorization code 방식이다.
  - 경로: `GET /v1/auth/battlenet/login` → Battle.net → `GET /v1/auth/battlenet/callback`
  - `state`를 검증한다. PKCE는 Battle.net이 지원하면 쓴다.
  - 엔드포인트는 APAC/US/EU 공통 `https://oauth.battle.net/{authorize,token}`이다. 중국은 범위 밖이다.
- 세션은 `api.hpgg.win`의 HttpOnly·Secure·SameSite=Lax 쿠키로 둔다. 사이트(hpgg.win)는 `credentials: "include"`로 호출한다. CORS는 `https://hpgg.win`만 credentials를 허용한다.
- 저장하는 것: Battle.net 계정 id, 배틀태그, 히오스 지역(KR/NA/EU, 처음 로그인할 때 고름), 가입 시각, 마지막 접속 시각. **Blizzard 토큰은 로그인 직후 버린다.**
- `GET /v1/me`, `POST /v1/auth/logout`, `DELETE /v1/me`(탈퇴: 계정과 영웅풀 즉시 삭제, 댓글 `account_id`는 비움).
- 비밀값: `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`을 `deploy/.env`에 둔다(pydantic-settings, SecretStr).

### B. 사이트
- 헤더에 "배틀넷으로 로그인" 버튼과 로그인 상태를 둔다. 정적 페이지라서 로그인 여부는 브라우저에서 `/v1/me`로 확인한다. 이 호출이 실패해도 페이지는 비회원 화면 그대로 보여야 한다.
- 개인정보처리방침 페이지(`/hots/privacy/`)를 둔다. 수집 항목, 목적, 보관 기간, 탈퇴 시 삭제, HP 데이터 출처를 적는다.

### C. 영웅풀 (최종: 직접 관리 + 채우기 버튼, 오너 10-30)
- 처음 안은 "이번 시즌 5판 이상 한 영웅으로 자동 구성"이었으나, 기록 없는 뉴비가 못 쓴다는 오너 지적으로 바꿨다.
- 영웅풀 = **회원이 고른 영웅 목록**(아무 영웅이나, 넣은 순서 유지). 조회·편집은 HP를 부르지 않는다.
- **"이번 시즌 기록으로 채우기"**(`POST /v1/me/pool/sync`)를 누를 때만 전적 검색 "이번 시즌" 카드의 `SeasonService`로 HP를 조회(같은 캐시·하루 예산·비공개 규칙) → 5판 이상(`POOL_MIN_GAMES`) 영웅을 추가, 1~4판은 후보로 돌려준다. 지역은 이때만 필요.
- HP 기록은 저장하지 않는다. 탈퇴 시 영웅풀 삭제.

### D. 밴픽 개인화 (최종)
- 밴픽 페이지에 [밴픽] [내 영웅풀 N] 탭(회원만, `?tab=pool`). 내 영웅풀 탭: 채우기 버튼·후보 칩·고른 영웅 칩·전체 영웅 그리드(역할 필터, 초성 검색)·비우기.
- 밴픽 탭의 "내 영웅풀만" 스위치: 켜면 **우리 팀 픽 추천만** 영웅풀 안으로. 밴·상대 팀 추천은 그대로. 점수식은 그대로(개인 승률 반영은 측정 뒤 별도 결정).
- 시안: https://claude.ai/artifact/HpcL9vYCoUzRqoNDPDitQL (오너 승인).

## 착수 전 확인할 것 (실제 클라이언트로)
- `/oauth/userinfo` 필드 이름(`sub`, `id`, `battletag` 예상)
- Battle.net 응답에 히오스 지역이 있는지. 없으면 지역 선택을 그대로 둔다.
- PKCE와 refresh token 지원 여부. refresh token은 필요 없다(우리 세션은 따로 둔다).

## 오너 작업
1. https://develop.battle.net/access/clients 에서 클라이언트를 만든다.
   - Redirect URL: `https://api.hpgg.win/v1/auth/battlenet/callback`
   - Service URL: `https://hpgg.win`
2. Client ID와 Secret을 Mac mini의 `main/deploy/.env`에 `BNET_CLIENT_ID=`, `BNET_CLIENT_SECRET=`로 넣는다(대화창에 붙여 넣지 말 것).

## 순서와 PR
A(로그인 서버, OAuth는 모킹한 테스트) → B(로그인 UI와 개인정보처리방침) → C(영웅풀) → D(밴픽 토글). PR은 단계마다 하나씩 올리고, 공개 전까지 `features.accounts`로 숨긴다.
