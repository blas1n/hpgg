// casccdn <cache_dir> <build_config>
// Lists every file of a HotS build from Blizzard's CDN: name \t ckey \t ekey \t size (#62).
// List only, on purpose: CascLib extracts by downloading whole 256 MB archives (13 GB for one
// hero in the spike); collector/cdn.py fetches the files by byte range instead.
#include "CascLib.h"
#include <cstdio>
#include <cstring>

int main(int argc, char **argv) {
    if (argc != 3) { fprintf(stderr, "usage: casccdn <cache_dir> <build_config>\n"); return 2; }
    CASC_OPEN_STORAGE_ARGS a; memset(&a, 0, sizeof(a));
    a.Size = sizeof(a);
    a.szLocalPath = argv[1]; a.szCodeName = "hero"; a.szRegion = "us";
    a.szBuildKey = argv[2];
    HANDLE hs;
    if (!CascOpenStorageEx(NULL, &a, true, &hs)) { fprintf(stderr, "open failed err=%d\n", GetCascError()); return 1; }
    CASC_FIND_DATA fd; HANDLE hf = CascFindFirstFile(hs, "*", &fd, NULL);
    int n = 0;
    if (hf) do {
        char ck[33], ek[33];
        for (int i = 0; i < 16; i++) { snprintf(ck + 2 * i, 3, "%02x", fd.CKey[i]); snprintf(ek + 2 * i, 3, "%02x", fd.EKey[i]); }
        printf("%s\t%s\t%s\t%llu\n", fd.szFileName, ck, ek, (unsigned long long)fd.FileSize);
        n++;
    } while (CascFindNextFile(hf, &fd));
    fprintf(stderr, "listed %d\n", n);
    if (hf) CascFindClose(hf);
    CascCloseStorage(hs);
    return n > 0 ? 0 : 1;
}
