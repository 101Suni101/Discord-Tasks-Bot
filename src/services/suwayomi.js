// src/services/suwayomi.js
const axios = require('axios');
require('dotenv').config();

class SuwayomiService {
    constructor() {
        let envUrl = process.env.SUWAYOMI_SERVER_URL || 'http://localhost:4567';
        if (envUrl.endsWith('/')) envUrl = envUrl.slice(0, -1);

        this.baseUrl = envUrl;

        this.api = axios.create({
            baseURL: this.baseUrl,
            timeout: 60000, // Timeout diperpanjang (Install kadang lama)
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        console.log(`🔌 [INIT] Service Ready (GraphQL Mode): ${this.baseUrl}`);
    }

    // --- FRAGMENT RAHASIA (SUPAYA SERVER GAK NOLAK) ---
    // Ini daftar isian yang diminta server (sesuai screenshotmu)
    get extensionFragment() {
        return `
            fragment EXTENSION_LIST_FIELDS on ExtensionType {
              pkgName
              name
              lang
              versionCode
              versionName
              iconUrl
              repo
              isNsfw
              isInstalled
              isObsolete
              hasUpdate
              __typename
            }
        `;
    }

    // 1. SEARCH MANGA (GraphQL)
    async search(query, sourceId) {
        try {
            console.log(`\n🔎 [GQL] Search: "${query}" (Source: ${sourceId || 'Global'})`);

            if (sourceId) {
                const payload = {
                    operationName: "GET_SOURCE_MANGAS_FETCH",
                    query: `
                        fragment MANGA_BASE_FIELDS on MangaType {
                          id
                          title
                          thumbnailUrl
                          thumbnailUrlLastFetched
                          inLibrary
                          initialized
                          sourceId
                          __typename
                        }
                        mutation GET_SOURCE_MANGAS_FETCH($input: FetchSourceMangaInput!) {
                          fetchSourceManga(input: $input) {
                            hasNextPage
                            mangas { ...MANGA_BASE_FIELDS __typename }
                            __typename
                          }
                        }
                    `,
                    variables: {
                        input: { type: "SEARCH", source: sourceId, query: query, filters: [], page: 1 }
                    }
                };
                const res = await this.api.post('/api/graphql', payload);
                if (res.data.errors) console.error("❌ Search Err:", JSON.stringify(res.data.errors));
                return res.data.data?.fetchSourceManga?.mangas || [];
            } else {
                // Search Library (Global)
                const res = await this.api.get(`/api/v1/search?query=${encodeURIComponent(query)}`);
                return res.data;
            }
        } catch (error) {
            console.error(`❌ [SEARCH ERROR]`, error.message);
            return [];
        }
    }

    // 2. ADD MANGA
    async addManga(mangaId) {
        try {
            const idAsInt = parseInt(mangaId); 
            console.log(`📥 [GQL] Adding Manga ID: ${idAsInt}`);

            // LANGKAH 1: Lakukan Mutation (Add ke Library)
            const mutationPayload = {
                operationName: "UPDATE_MANGA",
                query: `
                    mutation UPDATE_MANGA($input: UpdateMangaInput!, $updateCategoryInput: UpdateMangaCategoriesInput!, $updateCategories: Boolean!) {
                      updateMangaCategories(input: $updateCategoryInput) @include(if: $updateCategories) { manga { id } }
                      updateManga(input: $input) { manga { id inLibrary } }
                    }
                `,
                variables: {
                    input: { id: idAsInt, patch: { inLibrary: true } },
                    updateCategoryInput: { id: idAsInt, patch: { addToCategories: [], removeFromCategories: [] } },
                    updateCategories: true
                }
            };

            const mutRes = await this.api.post('/api/graphql', mutationPayload);
            if (mutRes.data.errors) {
                console.error("❌ Add Mutation Error:", JSON.stringify(mutRes.data.errors));
                return null;
            }

            // LANGKAH 2: Lakukan Query Detail (GET_MANGA_SCREEN) - Ini dari F12 kamu
            // Kita ambil data lengkapnya sekarang karena sudah ada di library
            console.log(`🔎 [GQL] Fetching Full Details for ID: ${idAsInt}`);
            
            const queryPayload = {
                operationName: "GET_MANGA_SCREEN",
                variables: { id: idAsInt },
                query: `
                    fragment MANGA_BASE_FIELDS on MangaType {
                      id title thumbnailUrl thumbnailUrlLastFetched inLibrary initialized sourceId __typename
                    }
                    fragment MANGA_CHAPTER_STAT_FIELDS on MangaType {
                      chapters { totalCount __typename } __typename
                    }
                    fragment MANGA_LIBRARY_FIELDS on MangaType {
                      ...MANGA_BASE_FIELDS
                      ...MANGA_CHAPTER_STAT_FIELDS
                      genre status artist author description
                      source { id displayName __typename }
                      __typename
                    }
                    fragment MANGA_SCREEN_FIELDS on MangaType {
                      ...MANGA_LIBRARY_FIELDS
                      realUrl
                      __typename
                    }
                    
                    query GET_MANGA_SCREEN($id: Int!) {
                      manga(id: $id) {
                        ...MANGA_SCREEN_FIELDS
                        __typename
                      }
                    }
                `
            };

            const queryRes = await this.api.post('/api/graphql', queryPayload);
            const mangaData = queryRes.data.data?.manga;

            if (!mangaData) return null;

            // Fix Thumbnail URL (Wajib ada)
            if (mangaData.thumbnailUrl && mangaData.thumbnailUrl.startsWith('/')) {
                mangaData.thumbnailUrl = `${this.baseUrl}${mangaData.thumbnailUrl}`;
            }

            return mangaData;

        } catch (error) {
            console.error(`❌ [ADD FAIL] ${error.message}`);
            return null;
        }
    }
    // 3. SEARCH EXTENSION (Auto Refresh Repo)
    async searchExtension(queryName) {
        try {
            // Ambil SEMUA extension (Mutation ini otomatis refresh repo server)
            const payload = {
                operationName: "GET_EXTENSIONS_FETCH",
                query: `
                    ${this.extensionFragment}
                    mutation GET_EXTENSIONS_FETCH($input: FetchExtensionsInput = {}) {
                      fetchExtensions(input: $input) {
                        extensions { ...EXTENSION_LIST_FIELDS __typename }
                        __typename
                      }
                    }
                `
            };

            const res = await this.api.post('/api/graphql', payload);
            const allExt = res.data.data?.fetchExtensions?.extensions || [];

            if (allExt.length === 0) console.log("⚠️ Repo kosong/belum ter-load.");

            // Filter di sisi Bot
            return allExt.filter(ext =>
                ext.name.toLowerCase().includes(queryName.toLowerCase()) ||
                ext.pkgName.toLowerCase().includes(queryName.toLowerCase())
            ).slice(0, 15);

        } catch (error) {
            console.error(`❌ [EXT SEARCH ERROR]`, error.message);
            return [];
        }
    }

    // 4. INSTALL EXTENSION (FIXED FULL FRAGMENT)
    async installExtension(pkgName) {
        try {
            console.log(`📥 [GQL] Request Install: "${pkgName}"`);

            const payload = {
                operationName: "UPDATE_EXTENSION",
                query: `
                    fragment EXTENSION_LIST_FIELDS on ExtensionType {
                      pkgName
                      name
                      lang
                      versionCode
                      versionName
                      iconUrl
                      repo
                      isNsfw
                      isInstalled
                      isObsolete
                      hasUpdate
                      __typename
                    }
                    
                    mutation UPDATE_EXTENSION($input: UpdateExtensionInput!) {
                      updateExtension(input: $input) {
                        extension {
                          ...EXTENSION_LIST_FIELDS
                          __typename
                        }
                        __typename
                      }
                    }
                `,
                // 👇 INI BAGIAN YANG KITA PERBAIKI SESUAI JSON KAMU
                variables: {
                    input: {
                        id: pkgName,        // Ternyata namanya "id", bukan "pkgName"
                        patch: {
                            install: true   // Kita harus kasih perintah "install: true"
                        }
                    }
                }
            };

            const res = await this.api.post('/api/graphql', payload);

            // Cek Error
            if (res.data.errors) {
                console.error("❌ [INSTALL FAIL] Server menolak:", JSON.stringify(res.data.errors, null, 2));
                return false;
            }

            // Validasi Data Balikan
            const extData = res.data.data?.updateExtension?.extension;
            if (extData) {
                console.log(`✅ [INSTALL SUKSES] ${extData.name}`);
                return true;
            } else {
                console.error("❌ [INSTALL FAIL] Respon kosong.");
                return false;
            }

        } catch (error) {
            console.error(`❌ [CONNECTION FAIL]`, error.message);
            return false;
        }
    }

    async forceRefreshLibrary() {
        try {
            console.log("🔄 [GQL] Memaksa Server Update Chapter (Global)...");

            const payload = {
                operationName: "UPDATE_LIBRARY",
                // Fragment Raksasa dari F12 kamu
                query: `
                    fragment UPDATER_JOB_INFO_FIELDS on UpdaterJobsInfoType {
                      isRunning
                      totalJobs
                      finishedJobs
                      skippedCategoriesCount
                      skippedMangasCount
                      __typename
                    }

                    fragment UPDATER_CATEGORY_FIELDS on CategoryUpdateType {
                      status
                      category { id name __typename }
                      __typename
                    }

                    fragment MANGA_CHAPTER_STAT_FIELDS on MangaType {
                      id unreadCount downloadCount bookmarkCount hasDuplicateChapters
                      chapters { totalCount __typename }
                      __typename
                    }

                    fragment MANGA_CHAPTER_NODE_FIELDS on MangaType {
                      firstUnreadChapter { id sourceOrder isRead mangaId __typename }
                      lastReadChapter { id sourceOrder lastReadAt __typename }
                      latestReadChapter { id sourceOrder lastReadAt __typename }
                      latestFetchedChapter { id fetchedAt __typename }
                      latestUploadedChapter { id uploadDate __typename }
                      __typename
                    }

                    fragment UPDATER_MANGA_FIELDS on MangaUpdateType {
                      status
                      manga {
                        id title thumbnailUrl
                        ...MANGA_CHAPTER_STAT_FIELDS
                        ...MANGA_CHAPTER_NODE_FIELDS
                        __typename
                      }
                      __typename
                    }

                    fragment UPDATER_STATUS_FIELDS on LibraryUpdateStatus {
                      jobsInfo { ...UPDATER_JOB_INFO_FIELDS __typename }
                      categoryUpdates { ...UPDATER_CATEGORY_FIELDS __typename }
                      mangaUpdates { ...UPDATER_MANGA_FIELDS __typename }
                      __typename
                    }

                    mutation UPDATE_LIBRARY($input: UpdateLibraryInput = {}) {
                      updateLibrary(input: $input) {
                        updateStatus { ...UPDATER_STATUS_FIELDS __typename }
                        __typename
                      }
                    }
                `,
                variables: {
                    input: {} // Input kosong sesuai request browser
                }
            };

            const res = await this.api.post('/api/graphql', payload);

            if (res.data.errors) {
                console.error("❌ [REFRESH FAIL] GraphQL Error:", JSON.stringify(res.data.errors));
                return false;
            }

            // Kalau sukses, server akan mulai update di background
            console.log("✅ [GQL] Perintah Update Terkirim!");
            return true;

        } catch (error) {
            console.error(`❌ [REFRESH FAIL] ${error.message}`);
            return false;
        }
    }

    // 6. CEK KAPAN TERAKHIR UPDATE (GraphQL Query)
    async getLastUpdateTimestamp() {
        try {
            const payload = {
                operationName: "GET_LAST_UPDATE_TIMESTAMP",
                query: `
                    query GET_LAST_UPDATE_TIMESTAMP {
                      lastUpdateTimestamp { timestamp __typename }
                    }
                `,
                variables: {}
            };
            const res = await this.api.post('/api/graphql', payload);
            return res.data.data?.lastUpdateTimestamp?.timestamp || 0;
        } catch (e) { return 0; }
    }

    // 7. AMBIL LIST RECENT UPDATE
    // ⚠️ NOTE: Kamu belum kirim GraphQL untuk "List Chapter Baru" (Tab Updates).
    // Jadi sementara kita masih pinjam REST API ini dulu ya.
    // (Kalau mau full GraphQL, kirim F12 dari Tab "Updates" nanti ku ubah).
    async getRecentUpdates() {
        try {
            const payload = {
                operationName: "GET_CHAPTERS_UPDATES",
                query: `
                    fragment CHAPTER_BASE_FIELDS on ChapterType {
                      id name mangaId scanlator realUrl sourceOrder chapterNumber __typename
                    }
                    fragment CHAPTER_STATE_FIELDS on ChapterType {
                      id isRead isDownloaded isBookmarked __typename
                    }
                    fragment MANGA_BASE_FIELDS on MangaType {
                      id title thumbnailUrl thumbnailUrlLastFetched inLibrary initialized sourceId __typename
                    }
                    
                    # Gabungan Data Chapter + Data Manga (HEMAT REQUEST!)
                    fragment CHAPTER_UPDATE_LIST_FIELDS on ChapterType {
                      ...CHAPTER_BASE_FIELDS
                      ...CHAPTER_STATE_FIELDS
                      fetchedAt
                      uploadDate
                      lastReadAt
                      manga { ...MANGA_BASE_FIELDS __typename }
                      __typename
                    }

                    fragment PAGE_INFO on PageInfo {
                      endCursor hasNextPage hasPreviousPage startCursor __typename
                    }

                    query GET_CHAPTERS_UPDATES($filter: ChapterFilterInput, $first: Int, $order: [ChapterOrderInput!]) {
                      chapters(filter: $filter, first: $first, order: $order) {
                        nodes { ...CHAPTER_UPDATE_LIST_FIELDS __typename }
                        pageInfo { ...PAGE_INFO __typename }
                        totalCount
                        __typename
                      }
                    }
                `,
                variables: {
                    filter: { inLibrary: { equalTo: true } }, // Hanya yang di library
                    order: [
                        { by: "FETCHED_AT", byType: "DESC" }, // Urutkan dari yang paling baru diambil bot
                        { by: "SOURCE_ORDER", byType: "DESC" }
                    ],
                    first: 50 // Ambil 50 aja cukup
                }
            };

            const res = await this.api.post('/api/graphql', payload);
            
            if (res.data.errors) {
                console.error("❌ [GET UPDATES] GQL Error:", JSON.stringify(res.data.errors));
                return [];
            }

            return res.data.data?.chapters?.nodes || [];
        } catch (error) {
            console.error(`❌ [GET UPDATES FAIL] ${error.message}`);
            return [];
        }
    }
    
    // 8. GET LIBRARY MANGAS (PAGINATION SYSTEM)
    async getLibraryMangas(limit = 1, offset = 0) {
        try {
            const payload = {
                operationName: "GET_LIBRARY_MANGAS_FULL",
                // Kita modifikasi Query No. 8 & 7 supaya ambil SEMUA library, bukan per kategori
                query: `
                    fragment MANGA_BASE_FIELDS on MangaType {
                      id title thumbnailUrl thumbnailUrlLastFetched inLibrary initialized sourceId __typename
                    }
                    fragment MANGA_CHAPTER_STAT_FIELDS on MangaType {
                      id unreadCount downloadCount bookmarkCount hasDuplicateChapters
                      chapters { totalCount __typename }
                      __typename
                    }
                    fragment MANGA_META_FIELDS on MangaMetaType {
                      mangaId key value __typename
                    }
                    
                    # FRAGMENT SUPER LENGKAP (Dari Payload No. 8)
                    fragment MANGA_LIBRARY_FIELDS on MangaType {
                      ...MANGA_BASE_FIELDS
                      ...MANGA_CHAPTER_STAT_FIELDS
                      genre
                      lastFetchedAt
                      inLibraryAt
                      status
                      artist
                      author
                      description
                      meta { ...MANGA_META_FIELDS __typename }
                      source { id displayName __typename }
                      realUrl
                      __typename
                    }

                    query GET_LIBRARY_MANGAS_FULL($first: Int, $offset: Int) {
                      # Kita filter condition: {inLibrary: true} biar semua muncul
                      mangas(condition: {inLibrary: true}, first: $first, offset: $offset) {
                        nodes {
                          ...MANGA_LIBRARY_FIELDS
                          __typename
                        }
                        totalCount
                        __typename
                      }
                    }
                `,
                variables: {
                    first: limit,
                    offset: offset
                }
            };

            const res = await this.api.post('/api/graphql', payload);

            if (res.data.errors) {
                console.error("❌ [LIBRARY] GQL Error:", JSON.stringify(res.data.errors));
                return null;
            }

            const data = res.data.data?.mangas;
            
            // Fix Thumbnail URL untuk setiap manga
            if (data?.nodes) {
                data.nodes.forEach(manga => {
                    if (manga.thumbnailUrl && manga.thumbnailUrl.startsWith('/')) {
                        manga.thumbnailUrl = `${this.baseUrl}${manga.thumbnailUrl}`;
                    }
                });
            }

            return data; // { nodes: [...], totalCount: 100 }

        } catch (error) {
            console.error(`❌ [LIBRARY FAIL] ${error.message}`);
            return null;
        }
    }

    // --- FITUR REST API ---
    async getSources() { try { return (await this.api.get('/api/v1/source/list?enabled=true')).data; } catch (e) { return []; } }
    async getManga(id) { try { return (await this.api.get(`/api/v1/manga/${id}`)).data; } catch (e) { return null; } }
    async getChapters(id) { try { return (await this.api.get(`/api/v1/manga/${id}/chapters`)).data; } catch (e) { return []; } }
    async startDownload(idx, id) { try { await this.api.post(`/api/v1/download/${id}/chapter/${idx}`); return true; } catch (e) { throw e; } }
}

module.exports = new SuwayomiService();