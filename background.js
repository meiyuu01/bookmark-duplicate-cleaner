'use strict';

// ====================================
// Bookmark Duplicate Cleaner Pro - Background Service
// ====================================

class BackgroundService {
    constructor() {
        this.version = '1.0.0';
        this.isInitialized = false;
        this.stats = {
            totalScans: 0,
            totalDuplicatesFound: 0,
    
        };
        this.init();
    }

    async init() {
        if (this.isInitialized) return;

        try {
            console.log(`[INIT] Duplicate Cleaner Pro Background Service v${this.version} 開始`);
            await this.loadStats();
            this.setupEventListeners();
            this.scheduleMaintenanceTasks();
            this.isInitialized = true;
            console.log('[COMPLETE] バックグラウンドサービス初期化完了');
        } catch (error) {
            console.error('[ERROR] バックグラウンドサービス初期化エラー:', error);
        }
    }

    async performScanWithRetry(retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const tree = await chrome.bookmarks.getTree();
                const allBookmarks = this.extractBookmarks(tree[0]);
                return this.findDuplicatesWithValidation(allBookmarks);
            } catch (error) {
                console.warn(`[WARN] スキャン試行 ${attempt}/${retries} 失敗:`, error);
                if (attempt === retries) {
                    throw new Error('[ERROR] 重複検出に失敗しました。ブラウザを再起動してください。');
                }
                await this.delay(1000 * attempt);
            }
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    validateBookmark(bookmark) {
        if (!bookmark.url || !/^https?:\/\/.+/.test(bookmark.url)) {
            return false;
        }

        if (!bookmark.title || bookmark.title.length > 1000) {
            return false;
        }

        if (bookmark.url.length > 2048) {
            return false;
        }

        return true;
    }

    findDuplicatesWithValidation(bookmarks) {
        const validBookmarks = bookmarks.filter(bookmark =>
            this.validateBookmark(bookmark)
        );

        const duplicateGroups = [];
        const urlMap = new Map();

        for (const bookmark of validBookmarks) {
            const normalizedUrl = this.normalizeUrl(bookmark.url);
            if (urlMap.has(normalizedUrl)) {
                urlMap.get(normalizedUrl).push(bookmark);
            } else {
                urlMap.set(normalizedUrl, [bookmark]);
            }
        }

        for (const [url, group] of urlMap) {
            if (group.length > 1) {
                duplicateGroups.push(group);
            }
        }

        return duplicateGroups;
    }

    normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.protocol + '//' + urlObj.hostname + urlObj.pathname;
        } catch {
            return url;
        }
    }

    extractBookmarks(node) {
        const bookmarks = [];

        if (node.url && this.validateBookmark(node)) {
            bookmarks.push(node);
        }

        if (node.children) {
            for (const child of node.children) {
                bookmarks.push(...this.extractBookmarks(child));
            }
        }

        return bookmarks;
    }

    // ==========================================
    // イベントリスナー設定
    // ==========================================

    setupEventListeners() {
        // インストール・アップデート時の処理
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstall(details);
        });

        // ブックマーク変更監視（軽量）
        chrome.bookmarks.onCreated.addListener((id, bookmark) => {
            this.onBookmarkEvent('created', { id, bookmark });
        });

        chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
            this.onBookmarkEvent('removed', { id, removeInfo });
        });

        // メッセージ処理（ポップアップとの通信）
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // 非同期レスポンス
        });

        // アラーム処理（定期メンテナンス）
        chrome.alarms.onAlarm.addListener((alarm) => {
            this.handleAlarm(alarm);
        });

        // 拡張機能クリック時（オプション）
        chrome.action.onClicked.addListener((tab) => {
            this.onActionClicked(tab);
        });
    }

    // ==========================================
    // インストール・アップデート処理
    // ==========================================

    async handleInstall(details) {
        console.log('[INSTALL] インストール詳細:', details);

        try {
            if (details.reason === 'install') {
                await this.handleFirstInstall();
            } else if (details.reason === 'update') {
                await this.handleUpdate(details.previousVersion);
            }
        } catch (error) {
            console.error('[ERROR] インストール処理エラー:', error);
        }
    }

    async handleFirstInstall() {
        console.log('[INIT] 初回インストール処理開始');

        // 初期バックアップ作成
        await this.createInitialBackup();

        // 定期メンテナンス設定
        this.scheduleMaintenanceTasks();

        // ウェルカム通知（Store審査に配慮した控えめ版）
        try {
            await chrome.notifications.create('welcome', {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Duplicate Cleaner Pro',
                message: '[COMPLETE] ブックマーク整理ツールをインストールしました。'
            });

            // 通知を3秒後に自動削除
            setTimeout(() => {
                chrome.notifications.clear('welcome');
            }, 3000);
        } catch (error) {
            // 通知権限がない場合は無視
            console.log('通知権限なし（正常動作）');
        }

        console.log('[COMPLETE] 初回インストール処理完了');
    }

    async handleUpdate(previousVersion) {
        console.log(`[UPDATE] アップデート: v${previousVersion} → v${this.version}`);

        try {
            // 設定移行（必要に応じて）
            await this.migrateSettings(previousVersion);

            // 更新ログ記録
            await this.saveStats();

            console.log('[COMPLETE] アップデート処理完了');
        } catch (error) {
            console.error('[ERROR] アップデート処理エラー:', error);
        }
    }

    async migrateSettings(previousVersion) {
        // バージョン固有の移行処理（将来のアップデート用）
        const majorVersion = previousVersion.split('.')[0];
        if (majorVersion === '0') {
            // Beta版からの移行
            console.log('[MIGRATE] Beta版からの設定移行');
            // 必要に応じて古い設定をクリーンアップ
        }
    }

    // ==========================================
    // ブックマーク変更監視
    // ==========================================

    onBookmarkEvent(type, data) {
        // 軽量ログのみ（重い処理はしない）
        const timestamp = Date.now();

        // 最近の活動として記録（最大100件まで）
        this.addRecentActivity({
            type,
            timestamp,
            id: data.id
        });

    }

    async addRecentActivity(activity) {
        try {
            const { recentActivities } = await chrome.storage.local.get('recentActivities');
            const activities = recentActivities || [];
            activities.unshift(activity);

            // 最大100件まで保持
            if (activities.length > 100) {
                activities.splice(100);
            }

            await chrome.storage.local.set({ recentActivities: activities });
        } catch (error) {
            console.error('[ERROR] 活動記録エラー:', error);
        }
    }

    // ==========================================
    // メッセージ処理（ポップアップとの通信）
    // ==========================================

    async handleMessage(request, sender, sendResponse) {
        try {
            console.log('[MSG] メッセージ受信:', request.action);

            switch (request.action) {
                case 'updateStats':
                    await this.updateScanStats(request.data);
                    sendResponse({ success: true });
                    break;

                case 'getStats':
                    const stats = await this.getStats();
                    sendResponse({ success: true, data: stats });
                    break;

                case 'performScan':
                    const result = await this.performScanWithRetry();
                    sendResponse({ success: true, data: result });
                    break;

                case 'createBackup':
                    await this.createBackup();
                    sendResponse({ success: true });
                    break;

                case 'restoreBackup':
                    await this.restoreBackup(request.data);
                    sendResponse({ success: true });
                    break;

                default:
                    console.warn('[WARN] 未知のアクション:', request.action);
                    sendResponse({ success: false, error: 'Unknown action' });
                    break;
            }
        } catch (error) {
            console.error('[ERROR] メッセージ処理エラー:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    // ==========================================
    // 統計管理
    // ==========================================

    async loadStats() {
        try {
            const { stats } = await chrome.storage.local.get('stats');
            if (stats) {
                this.stats = { ...this.stats, ...stats };
            }
        } catch (error) {
            console.error('[ERROR] 統計データ読み込みエラー:', error);
        }
    }

    async saveStats() {
        try {
            await chrome.storage.local.set({ stats: this.stats });
        } catch (error) {
            console.error('[ERROR] 統計データ保存エラー:', error);
        }
    }

    async getStats() {
        await this.loadStats();
        return this.stats;
    }

    async updateScanStats(data) {
        this.stats.totalScans += 1;
        this.stats.totalDuplicatesFound += data.duplicatesFound || 0;
        await this.saveStats();
    }

    // ==========================================
    // スキャン機能
    // ==========================================

    async performScan() {
        try {
            // ブックマークツリー取得
            const bookmarkTree = await chrome.bookmarks.getTree();
            const allBookmarks = this.flattenBookmarks(bookmarkTree);

            // 重複検出
            const duplicates = this.findDuplicates(allBookmarks);

            console.log(`[COMPLETE] スキャン完了: ${duplicates.length}個の重複グループを検出`);

            return {
                totalBookmarks: allBookmarks.length,
                duplicateGroups: duplicates.length,
                duplicates: duplicates,
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('[ERROR] スキャンエラー:', error);
            throw error;
        }
    }

    flattenBookmarks(bookmarkTree, result = []) {
        for (const node of bookmarkTree) {
            if (node.url) {
                // URL付きブックマーク
                result.push({
                    id: node.id,
                    title: node.title,
                    url: node.url,
                    parentId: node.parentId,
                    dateAdded: node.dateAdded
                });
            }

            if (node.children) {
                this.flattenBookmarks(node.children, result);
            }
        }

        return result;
    }

    findDuplicates(bookmarks) {
        const urlGroups = {};

        // URLでグループ化
        bookmarks.forEach(bookmark => {
            const url = this.normalizeUrl(bookmark.url);
            if (!urlGroups[url]) {
                urlGroups[url] = [];
            }
            urlGroups[url].push(bookmark);
        });

        // 重複のみを返す
        return Object.values(urlGroups).filter(group => group.length > 1);
    }

    // ==========================================
    // バックアップ機能
    // ==========================================

    async createInitialBackup() {
        try {
            console.log('[PROCESSING] 初期バックアップ作成中...');
            await this.createBackup('initial');
            console.log('[COMPLETE] 初期バックアップ作成完了');
        } catch (error) {
            console.error('[ERROR] 初期バックアップ作成エラー:', error);
        }
    }

    async createBackup(type = 'manual') {
        try {
            const bookmarkTree = await chrome.bookmarks.getTree();
            const backup = {
                type: type,
                timestamp: Date.now(),
                version: this.version,
                bookmarks: bookmarkTree
            };

            // バックアップをストレージに保存
            const backupKey = `backup_${Date.now()}`;
            await chrome.storage.local.set({ [backupKey]: backup });

            // バックアップリストに追加
            const { backupList } = await chrome.storage.local.get('backupList');
            const list = backupList || [];
            list.unshift({ key: backupKey, timestamp: backup.timestamp, type: type });

            // 最大10個まで保持
            if (list.length > 10) {
                const oldBackups = list.splice(10);
                // 古いバックアップを削除
                for (const oldBackup of oldBackups) {
                    await chrome.storage.local.remove(oldBackup.key);
                }
            }

            await chrome.storage.local.set({ backupList: list });
            console.log(`[COMPLETE] バックアップ作成完了: ${backupKey}`);

            return backupKey;
        } catch (error) {
            console.error('[ERROR] バックアップ作成エラー:', error);
            throw error;
        }
    }

    async restoreBackup(backupKey) {
        try {
            console.log(`[INIT] バックアップ復元開始: ${backupKey}`);

            const { [backupKey]: backup } = await chrome.storage.local.get(backupKey);
            if (!backup) {
                throw new Error('[ERROR] バックアップが見つかりません');
            }

            // 現在のブックマークを削除（ルートフォルダ以外）
            await this.clearBookmarks();

            // バックアップからブックマークを復元
            await this.restoreBookmarksFromTree(backup.bookmarks);

            console.log('[COMPLETE] バックアップ復元完了');
        } catch (error) {
            console.error('[ERROR] バックアップ復元エラー:', error);
            throw error;
        }
    }

    async clearBookmarks() {
        const bookmarkTree = await chrome.bookmarks.getTree();

        for (const rootNode of bookmarkTree) {
            if (rootNode.children) {
                for (const child of rootNode.children) {
                    if (child.children) {
                        // フォルダの場合、中身を削除
                        await this.removeBookmarkChildren(child.id);
                    }
                }
            }
        }
    }

    async removeBookmarkChildren(folderId) {
        const children = await chrome.bookmarks.getChildren(folderId);
        for (const child of children) {
            await chrome.bookmarks.removeTree(child.id);
        }
    }

    async restoreBookmarksFromTree(bookmarkTree) {
        console.log('[WARN] 復元機能は次バージョンで実装予定');
        throw new Error('復元機能は開発中です');
    }

    // ==========================================
    // メンテナンス・アラーム処理
    // ==========================================

    scheduleMaintenanceTasks() {
        // 日次メンテナンス
        chrome.alarms.create('dailyMaintenance', {
            when: Date.now() + (24 * 60 * 60 * 1000), // 24時間後
            periodInMinutes: 24 * 60 // 24時間間隔
        });

        console.log('[CONFIG] 定期メンテナンスタスクを設定しました');
    }

    async handleAlarm(alarm) {
        console.log('[ALARM] アラーム実行:', alarm.name);

        try {
            switch (alarm.name) {
                case 'dailyMaintenance':
                    await this.performDailyMaintenance();
                    break;
                default:
                    console.log('[ALARM] 未知のアラーム:', alarm.name);
                    break;
            }
        } catch (error) {
            console.error('[ERROR] アラーム処理エラー:', error);
        }
    }

    async performDailyMaintenance() {
        console.log('[MAINTENANCE] 日次メンテナンス開始');

        try {
            // 古いアクティビティログを削除
            await this.cleanupOldActivities();

            // 古いバックアップを削除
            await this.cleanupOldBackups();

            // 統計データを更新
            await this.saveStats();

            console.log('[COMPLETE] 日次メンテナンス完了');
        } catch (error) {
            console.error('[ERROR] 日次メンテナンスエラー:', error);
        }
    }

    async cleanupOldActivities() {
        const { recentActivities } = await chrome.storage.local.get('recentActivities');
        if (!recentActivities) return;

        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const filtered = recentActivities.filter(activity => activity.timestamp > thirtyDaysAgo);

        if (filtered.length !== recentActivities.length) {
            await chrome.storage.local.set({ recentActivities: filtered });
            console.log(`[DELETE] ${recentActivities.length - filtered.length}件の古いアクティビティを削除`);
        }
    }

    async cleanupOldBackups() {
        const { backupList } = await chrome.storage.local.get('backupList');
        if (!backupList) return;

        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const oldBackups = backupList.filter(backup =>
            backup.timestamp < sevenDaysAgo && backup.type !== 'initial'
        );

        for (const backup of oldBackups) {
            await chrome.storage.local.remove(backup.key);
        }

        if (oldBackups.length > 0) {
            const updatedList = backupList.filter(backup => !oldBackups.includes(backup));
            await chrome.storage.local.set({ backupList: updatedList });
            console.log(`[DELETE] ${oldBackups.length}件の古いバックアップを削除`);
        }
    }

    // ==========================================
    // アクションクリック処理
    // ==========================================

    onActionClicked(tab) {
        console.log('[ACTION] 拡張機能がクリックされました');

        // ポップアップが定義されている場合は何もしない
        // ポップアップがない場合は新しいタブを開く（オプション）
        try {
            chrome.tabs.create({
                url: 'popup.html',
                active: true
            });
        } catch (error) {
            console.log('[ACTION] ポップアップ表示（通常動作）');
        }
    }

    // ==========================================
    // ユーティリティ
    // ==========================================

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==========================================
    // エラーハンドリング
    // ==========================================

    handleError(error, context = '') {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            context: context,
            timestamp: Date.now(),
            version: this.version
        };

        console.error(`[ERROR] エラー [${context}]:`, errorInfo);

        // 重要なエラーの場合は統計に記録
        if (context.includes('scan') || context.includes('backup')) {
            this.recordError(errorInfo);
        }

        return errorInfo;
    }

    async recordError(errorInfo) {
        try {
            const { errorLog } = await chrome.storage.local.get('errorLog');
            const log = errorLog || [];
            log.unshift(errorInfo);

            // 最大50件まで保持
            if (log.length > 50) {
                log.splice(50);
            }

            await chrome.storage.local.set({ errorLog: log });
        } catch (error) {
            console.error('[ERROR] エラーログ記録失敗:', error);
        }
    }
}

// ==========================================
// サービス開始
// ==========================================

// バックグラウンドサービスを開始
const backgroundService = new BackgroundService();
