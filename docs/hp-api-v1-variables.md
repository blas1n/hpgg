# Heroes Profile API v1 — Variables (docs snapshot, 2026-09-28)

base: https://www.heroesprofile.com/api/external/v1 · auth: Authorization: Bearer <key>

```
Variables
What every parameter accepts, read from the same tables the validators check against. Values are case-sensitive and must match exactly; anything else is rejected with a 422 naming the parameter.
hero
Most hero and player endpoints
A hero name, exactly as spelled here. Always a name in this API, never an id — endpoints whose internals want an id translate for you.
Abathur
Alarak
Alexstrasza
Ana
Anduin
Anub'arak
Artanis
Arthas
Auriel
Azmodan
Blaze
Brightwing
Cassia
Chen
Cho
Chromie
D.Va
Deathwing
Deckard
Dehaka
Diablo
E.T.C.
Falstad
Fenix
game_map
also map
Global statistics, player breakdowns
A map name, case-insensitive. `players/maps/single` calls it `map`; everywhere else it is `game_map`. Only playable maps are listed and accepted, except by `replays`, which also takes retired ones.
Alterac Pass
Battlefield of Eternity
Blackheart's Bay
Braxis Holdout
Braxis Outpost
Cursed Hollow
Dragon Shire
Garden of Terror
Hanamura Temple
Haunted Mines
Industrial District
Infernal Shrines
Lost Cavern
Silver City
Sky Temple
Tomb of the Spider Queen
Towers of Doom
Volskaya Foundry
Warhead Junction
game_type
Nearly everything
Either form works — `Storm League` or `sl`, case-insensitive. Comma-separated for endpoints that accept several. Required by the global statistics endpoints. Player endpoints default to every type, except rating history, which defaults to `sl`. Leaderboards also default to `sl`.
qm
Quick Match
ud
Unranked Draft
hl
Hero League
tl
Team League
sl
Storm League
ar
ARAM
role
Player breakdowns, leaderboards, global filters
A role name.
Bruiser
Healer
Melee Assassin
Ranged Assassin
Support
Tank
region
Player endpoints (required), global filters (optional)
Either form works — `NA` or `1`. Player endpoints require it; global endpoints treat its absence as every region.
1
NA
2
EU
3
KR
5
CN
hero_level
Global statistics
A band, not a level — and the value is the band's lower bound, so `25` means 25 to 40 rather than \"25 or above\". Levels are stored bucketed, so a value that is not one of these codes matches nothing. Comma-separated for several bands.
1
1-5
5
5-10
10
10-15
15
15-25
25
25-40
40
40-60
60
60-80
80
80-100
100
100+
league_tier
also hero_league_tier, role_league_tier, tierrank
Global statistics, leaderboards
A tier id, not a name. All four parameters take the same set.
0
wood
1
bronze
2
silver
3
gold
4
platinum
5
diamond
6
master
7
all
timeframe_type
Every global statistics endpoint
How `timeframe` is read. `minor` is one build, `major` a patch line, `major_grouped` several patches together.
minor
major
major_grouped
timeframe
Every global statistics endpoint
A build (`2.55.17.97771`) when `timeframe_type` is `minor`, or a patch (`2.55`) when it is `major`. This is every patch that can be queried: older data exists but is not offered, the same limit the site applies to its own filters.
2.55.17.98025
2.55.17.97771
2.55.17.97650
2.55.17.97605
2.55.16.97039
2.55.16.96881
2.55.16.96870
2.55.16.96846
2.55.15.96477
2.55.15.96443
2.55.15.96370
2.55.14.95918
2.55.14.95883
2.55.14.95817
2.55.14.95774
2.55.13.95301
2.55.13.95213
2.55.12.94786
2.55.12.94714
2.55.10.94470
2.55.10.94387
2.55.10.94189
2.55.10.93810
2.55.9.93640
season
Leaderboards, player endpoints
A season id. Omit it on player endpoints for a career total.
33
32
31
30
29
28
27
26
25
24
23
22
21
20
19
18
17
16
15
14
13
12
11
10
season (NGS)
NGS endpoints
An NGS season number — not the same thing as a ranked season id. The NGS page endpoints default to the latest; team and player endpoints treat its absence as every season.
22
21
20
19
18
17
16
15
14
13
12
11
10
9
8
7
6
division
NGS endpoints
An NGS division, spelled exactly as here.
A
A East
A West
B
B East
B NorthEast
B SouthEast
B West
C
C East
C West
D
D East
D NorthEast
D SouthEast
D West
E
E East
E West
Heroic
Nexus
NGS
Storm
groupsize
heroes/stats, leaderboards, players/friendfoe
Party size, by name rather than number.
All
Solo
Duo
3 Players
4 Players
5 Players
teamoneparty
also teamtwoparty, ally_combo, enemy_combo
Party statistics
A party composition code. Five digits, one per group size, read left to right as five-stack, quad, triple, double, solo — each digit being the number of *players* in groups of that size, so every code sums to five. `00023` is two players in a duo plus three solos. These are also the keys of the `/party` response and the values of its `ally_combo` and `enemy_combo` fields.
50000
1 team of 5
00005
5 Solo
00023
1 Double, 3 Solo
00041
2 Double, 1 Solo
00302
1 Triple, 2 Solo
00320
1 Triple, 1 Double
04001
1 Quad, 1 Solo
talentbuildtype
heroes/talents/builds
Which ranking decides the builds returned. Defaults to `Popular`.
Popular
HP Algorithm
Unique Lvl 1
Unique Lvl 4
Unique Lvl 7
Unique Lvl 10
Unique Lvl 13
Unique Lvl 16
Unique Lvl 20
statfilter
← Back to /heroes/stats
← Back to /heroes/talents/builds
← Back to /heroes/talents/builds/all
← Back to /heroes/talents/details
heroes/stats, heroes/talents/details, heroes/talents/builds, heroes/talents/builds/all
Which statistic to report. Defaults to `win_rate`. Anything else needs `timeframe_type=minor` and at most five timeframes.
win_rate
game_time
kills
takedowns
deaths
siege_damage
hero_damage
healing
damage_taken
experience_contribution
assists
highest_kill_streak
structure_damage
minion_damage
creep_damage
summon_damage
self_healing
town_kills
time_spent_dead
merc_camp_captures
watch_tower_captures
protection_Allies
silencing_enemies
rooting_enemies
mirror
Global statistics
Whether mirror matches are included.
0
Exclude mirror matches
1
Include them
Reference
get
/heroes
Every hero, with role, type and release date.
Counts against your
heroes
allowance.
Parameters
hero
query
string
Restrict to one hero, by name or short name. e.g. Anduin
Restrict to one hero, by name or short name.
e.g. Anduin
role
query
string
Restrict to one role, by name. e.g. Healer
Restrict to one role, by name.
e.g. Healer
mode
query
string json, csv
string
json, csv
Response format. `csv` returns the same data as a downloadable file, flattened to one row per record.
e.g. csv
Sign in
to run this endpoint from here.
Responses
200
application/json
Success
heroes
array of object
401
application/json
No key, or a key that is not recognised. Codes: `unauthenticated`.
403
application/json
The key is valid but may not make this call. Codes: `account_suspended`, `account_terminated`, `terms_not_accepted`, `subscription_inactive`, `project_details_required`, `plan_unresolved`, `endpoint_not_in_plan`.
404
application/json
Nothing found for what was asked. Codes: `not_found`.
422
application/json
A parameter is missing or not accepted. Codes: `invalid_parameters`, `missing_*`, `unknown_*`.
429
application/json
Too many requests: the per-minute limit, or the weekly allowance. See `Retry-After`. Codes: `rate_limited`, `quota_exceeded`.
500
application/json
Failed on our side. Not charged. Codes: `server_error`.
get
/heroes/talents
Every talent for every hero.
Counts against your
heroes_talents
allowance.
Parameters
hero
query
string
Restrict to one hero by name. e.g. Anduin
Restrict to one hero by name.
e.g. Anduin
mode
query
string json, csv
string
json, csv
Response format. `csv` returns the same data as a downloadable file, flattened to one row per record.
e.g. csv
Sign in
to run this endpoint from here.
Responses
200
application/json
Success
talents
object
401
application/json
No key, or a key that is not recognised. Codes: `unauthenticated`.
403
application/json
The key is valid but may not make this call. Codes: `account_suspended`, `account_terminated`, `terms_not_accepted`, `subscription_inactive`, `project_details_required`, `plan_unresolved`, `endpoint_not_in_plan`.
404
application/json
Nothing found for what was asked. Codes: `not_found`.
422
application/json
A parameter is missing or not accepted. Codes: `invalid_parameters`, `missing_*`, `unknown_*`.
429
application/json
Too many requests: the per-minute limit, or the weekly allowance. See `Retry-After`. Codes: `rate_limited`, `quota_exceeded`.
500
application/json
Failed on our side. Not charged. Codes: `server_error`.
get
/maps
Every map, with its id and rotation status.
Counts against your
maps
allowance.
Parameters
mode
query
string json, csv
string
json, csv
Response format. `csv` returns the same data as a downloadable file, flattened to one row per record.
e.g. csv
Sign in
to run this endpoint from here.
Responses
200
application/json
Success
maps
array of object
401
application/json
No key, or a key that is not recognised. Codes: `unauthenticated`.
403
application/json
The key is valid but may not make this call. Codes: `account_suspended`, `account_terminated`, `terms_not_accepted`, `subscription_inactive`, `project_details_required`, `plan_unresolved`, `endpoint_not_in_plan`.
404
application/json
Nothing found for what was asked. Codes: `not_found`.
422
application/json
A parameter is missing or not accepted. Codes: `invalid_parameters`, `missing_*`, `unknown_*`.
429
application/json
Too many requests: the per-minute limit, or the weekly allowance. See `Retry-After`. Codes: `rate_limited`, `quota_exceeded`.
500
application/json
Failed on our side. Not charged. Codes: `server_error`.
get
/mmr/tier
The league tier a rating falls in.
Counts against your
mmr_tier
allowance.
Parameters
game_type required
game_type
required
query
string
One game type, by short name or display name — `sl` and `Storm League` both work, case-insensitive.
e.g. Storm League
mmr required
mmr
required
query
integer
The rating to place. A whole number. e.g. 2400
The rating to place. A whole number.
e.g. 2400
mode
query
string json, csv
string
json, csv
Response format. `csv` returns the same data as a downloadable file, flattened to one row per record.
e.g. csv
Sign in
to run this endpoint from here.
Responses
200
application/json
Success
game_type
string
mmr
integer
tier
string
401
application/json
No key, or a key that is not recognised. Codes: `unauthenticated`.
403
application/json
The key is valid but may not make this call. Codes: `account_suspended`, `account_terminated`, `terms_not_accepted`, `subscription_inactive`, `project_details_required`, `plan_unresolved`, `endpoint_not_in_plan`.
404
application/json
Nothing found for what was asked. Codes: `not_found`.
422
application/json
A parameter is missing or not accepted. Codes: `invalid_parameters`, `missing_*`, `unknown_*`.
429
application/json
Too many requests: the per-minute limit, or the weekly allowance. See `Retry-After`. Codes: `rate_limited`, `quota_exceeded`.
500
application/json
Failed on our side. Not charged. Codes: `server_error`.
get
/patches
Game versions, with the season each belongs to.
Counts against your
patches
allowance.
Parameters
mode
query
string json, csv
string
json, csv
Response format. `csv` returns the same data as a downloadable file, flattened to one row per record.
e.g. csv
Sign in
to run this endpoint from here.
Responses
200
application/json
Success
patches
array of object
401
application/json
No key, or a key that is not recognised. Codes: `unauthenticated`.
403
application/json
The key is valid but may not make this call. Codes: `account_suspended`, `account_terminated`, `terms_not_accepted`, `subscription_inactive`, `project_details_required`, `plan_unresolved`, `endpoint_not_in_plan`.
404
application/json
Nothing found for what was asked. Codes: `not_found`.
422
application/json
A parameter is missing or not accepted. Codes: `invalid_parameters`, `missing_*`, `unknown_*`.
429
application/json
Too many requests: the per-minute limit, or the weekly allowance. See `Retry-After`. Codes: `rate_limited`, `quota_exceeded`.
500
application/json
Failed on our side. Not charged. Codes: `server_error`.
Global Hero Stats
get
/compositions
Which team compositions win, and how often.
Powers
heroesprofile.com/Global/Compositions
— the same data, filtered the same way.
Counts against your
global_compositions
allowance.
The usual 60 requests a minute, dropping to 1 when `group_by_map=true`
```
