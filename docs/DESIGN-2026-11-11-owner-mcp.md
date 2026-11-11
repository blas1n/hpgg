# 설계: 오너 전용 원격 MCP (ChatGPT 커넥터)

작성 2026-11-11 · 상태: **구현 중** · 오너 요청 11-11 ("내 전용이야. 진행해")

오너가 ChatGPT로 영웅풀 분석과 전적 복기를 할 때마다 화면을 캡처하거나 JSON을 뽑아 붙여 넣는다. ChatGPT가 직접 오너의 폭풍리그 전적을 읽도록 api.hpgg.win에 원격 MCP를 붙인다.

## 범위

- **오너 한 명 전용.** HP 약관 §3은 HP 데이터를 우리 API로 노출하는 것을 막는다. 본인 분석용 개인 프로젝트는 예외다. 그래서 토큰은 `MCP_OWNER_BATTLETAG`로 로그인한 Battle.net 계정에만 발급한다. 다른 계정은 동의 화면에서 거절한다.
- **폭풍리그만.** 복기는 폭풍리그만 본다(오너 10-27). 빠른 대전은 받지 않는다.
- **읽기 전용.** 도구는 조회만 한다. 영웅풀 수정은 사이트에서 한다.
- `MCP_OWNER_BATTLETAG`가 비어 있으면 MCP 경로를 아예 붙이지 않는다.

## ChatGPT 연결 조건 (OpenAI Apps SDK 인증 문서, 2026-11-11 확인)

- 원격 HTTPS MCP만 된다. 로컬 stdio는 안 된다.
- 인증은 OAuth 2.1 인가 코드 + PKCE(S256) 또는 인증 없음 둘뿐이다. 고정 API 키나 헤더는 못 쓴다.
- 클라이언트 등록은 DCR(`registration_endpoint`), CIMD, 미리 만든 클라이언트 중 하나. DCR로 간다(오너가 값을 입력할 필요 없음).
- 보호 자원 메타데이터(`/.well-known/oauth-protected-resource`)와 401의 `WWW-Authenticate`로 인가 서버를 알린다.
- 리다이렉트 URI: `https://chatgpt.com/connector_platform_oauth_redirect` 또는 `https://chatgpt.com/connector/oauth/{callback_id}`.

## 구조

MCP Python SDK 2.x(`MCPServer`)가 인가 서버 경로(`/.well-known/oauth-authorization-server`, `/authorize`, `/token`, `/register`), 보호 자원 메타데이터, `/mcp`(Streamable HTTP)를 만들어 준다. 그 Starlette 앱을 FastAPI 앱 뒤에 `/`로 붙인다. 기존 `/v1/...` 경로가 먼저 맞는다.

```
ChatGPT ─/register─▶ hpgg (DCR, 리다이렉트 URI는 chatgpt.com 두 형태만)
        ─/authorize─▶ hpgg ─302─▶ /mcp/consent?req=…
                                    ├ 로그인 안 됨 → Battle.net 로그인 → 다시 /mcp/consent
                                    ├ 오너 아님 → access_denied
                                    └ 오너 → "허용" 버튼(POST) → 코드 → ChatGPT
        ─/token (code + PKCE)─▶ access(1시간) + refresh(30일, 쓸 때마다 교체)
        ─/mcp (Bearer)─▶ 도구
```

- **동의 화면을 거친다.** 자동 승인하면, 남이 자기 ChatGPT 커넥터로 만든 인가 링크를 오너가 누르는 것만으로 그 사람에게 오너 토큰이 간다. 허용은 POST(SameSite=Lax 쿠키는 다른 사이트의 POST에 실리지 않음)이고 Origin도 확인한다. 화면에 클라이언트 이름과 리다이렉트 주소를 보여 준다.
- **토큰은 해시만 저장한다.** 세션 쿠키와 같은 방식(SHA-256). DB 사본으로는 아무 토큰도 못 쓴다.
- **토큰은 이 MCP 주소(`resource`) 전용**이다. `validate_token_resource`로 다른 resource 토큰을 거절한다.
- **Host 검사:** `MCP_ALLOWED_HOSTS`(기본 `api.hpgg.win`)만 받는다(DNS rebinding 방지).

## 데이터

| 무엇 | 어디서 | 저장 |
|---|---|---|
| 내 경기 한 줄(통계·특성·MMR) | `/players/matches?game_type=sl` | `owner_matches`에 계속 보관 |
| 경기 요약(길이, 양 팀 영웅, 밴, 드래프트, 파티 크기, 분당 팀 경험치) | `/replay/{id}` | 같은 행에 보관. **다른 선수의 배틀태그와 개인 통계는 저장하지 않는다** |
| 한 경기의 10명 전체 통계 | `ReplayService` (기존, 24시간 캐시, 비공개 전환자 제외) | 저장 안 함. 응답에서 배틀태그를 `player_1…`로 바꿈 |
| 현재 MMR·티어 | `PlayerService` (기존) | 기존 캐시 |
| 영웅풀 | `PoolService` (기존) | 기존 |
| 고티어 기준선, 티어표 | `data/latest/*.json`(+ `previous/`), `sl_averages.json`, `meta.json` | 컨테이너에 `data/`를 읽기 전용으로 붙임 |

- **동기화는 쓸 때만 한다.** 도구를 부를 때 마지막 동기화가 30분보다 오래됐으면 백그라운드로 시작한다. 목록은 첫 페이지부터 받다가 이미 있는 경기가 나오면 멈춘다. 처음엔 3페이지(226경기), 이후엔 보통 1회.
- 목록 버킷은 사이트와 같은 `player_match_history`(주 500)를 쓰고 기존 가드(`match_quota_floor`, `match_daily_budget`)를 지킨다. 리플레이는 `replay_data` 가드를 지키고, HP 분당 60회 한도에 맞춰 1.1초 간격으로 받는다.
- 응답마다 `sync` 상태(마지막 동기화, 진행 중 여부, 상세가 아직 없는 경기 수)를 붙인다. 상세가 없는 경기는 관련 필드가 null이다.

## 도구

| 도구 | 내용 |
|---|---|
| `get_status` | 오너, 현재 MMR·티어·승패, 저장된 경기 수와 기간, 동기화 상태, 데이터 한계 |
| `list_matches` | 영웅·맵·역할·결과·기간으로 거른 내 경기 목록 (최신순, 페이지) |
| `get_match` | 한 경기 상세: 10명 통계·특성(익명), 밴·드래프트, 분당 팀 경험치 |
| `summarize` | `hero`/`map`/`role`/`map_hero`/`first_pick`/`pick_order`/`party_size`/`first_to_ten`별 경기 수·승패·승률·합계·총 게임 시간 |
| `get_hero_pool` | 사이트에 저장한 영웅풀 |
| `get_baseline` | 고티어 영웅 승률(전체, 맵별; 기본 전 지역, KR은 표본이 작음)과 영웅별 평균 통계 |
| `get_tier_list` | 사이트 티어표와 같은 S~F 등급: 모드·구간·지역·맵·역할, 참조 패치, 표본 미달 영웅 따로 (오너 11-11 추가) |

| `get_hero` | 영웅 상세 전체: 등급·순위(이전 패치 대비)·승률·픽·밴, 맵별 승률, 지역×구간 표, 리그별·게임 시간별 승률, 상성·궁합, 특성 빌드, 최근 패치·핫픽스 (오너 11-11 추가) |

**계산식 두 벌.** 티어 공식(`web/src/formula.ts`)과 영웅 상세의 상성·빌드·리그별·시간별 계산(`web/src/lib`)을 MCP는 Python(`server/mcp/tiers.py`, `hero.py`)으로 다시 계산한다. `tests/fixtures/tier_formula_golden.json`, `hero_views_golden.json`의 기대값을 TypeScript가 쓰고, 웹 vitest와 서버 pytest가 둘 다 그 값과 비교한다. 사이트 규칙을 바꾸면 `cd web && UPDATE_MCP_GOLDEN=1 npx vitest run tests/formula.test.ts tests/heroGolden.test.ts`로 기대값을 다시 쓰고, 실패하는 pytest에 맞춰 Python을 고친다. 패치 변경 내역은 파일 그대로 준다(사이트의 핫픽스 합치기는 옮기지 않음).

원칙은 11-06 추출과 같다. 관측값과 파생값을 나누고(`_derived` 접미사), 없는 값은 null, 캐리력·플레이 스타일 같은 평가 값은 만들지 않는다. 영웅·맵 이름은 영어와 한국어 둘 다 받고, 응답에 둘 다 준다.

## 하지 않는 것

- 다른 사용자에게 열기 (HP와 합의가 먼저)
- 빠른 대전, 쓰기 도구, 리플레이 파일(.StormReplay) 보관
