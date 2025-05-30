'use strict';

// 重複検出エンジン
class DuplicateDetector {
    constructor() {
        this.settings = {
            enableUrlNormalization: true,
            enableSmartDetection: true,
            batchSize: 500
        };
    }

    async detectDuplicates(bookmarks, progressCallback) {
        const duplicates = [];
        const processed = new Set();

        try {
            // フェーズ1: 完全一致検出
            await this.detectExactDuplicates(bookmarks, duplicates, processed, progressCallback);

            // フェーズ2: URL正規化検出
            if (this.settings.enableUrlNormalization) {
                await this.detectNormalizedDuplicates(bookmarks, duplicates, processed, progressCallback);
            }

            return duplicates;
        } catch (error) {
            console.error('[ERROR] 重複検出エラー:', error);
            throw new Error('[ERROR] 重複検出中にエラーが発生しました');
        }
    }

    async detectExactDuplicates(bookmarks, duplicates, processed, progressCallback) {
        const urlMap = new Map();

        for (let i = 0; i < bookmarks.length; i += this.settings.batchSize) {
            const batch = bookmarks.slice(i, i + this.settings.batchSize);

            batch.forEach(bookmark => {
                if (processed.has(bookmark.id)) return;

                const url = bookmark.url.trim();
                if (!urlMap.has(url)) {
                    urlMap.set(url, []);
                }
                urlMap.get(url).push(bookmark);
            });

            const progress = (i / bookmarks.length) * 50;
            progressCallback?.(progress, `[PROCESSING] 完全一致チェック: ${Math.min(i + this.settings.batchSize, bookmarks.length)}/${bookmarks.length}`);

            await this.delay(1);
        }

        // 重複グループ処理
        this.processDuplicateGroups(urlMap, duplicates, processed, 'exact');
    }

    async detectNormalizedDuplicates(bookmarks, duplicates, processed, progressCallback) {
        const normalizedMap = new Map();

        for (let i = 0; i < bookmarks.length; i += this.settings.batchSize) {
            const batch = bookmarks.slice(i, i + this.settings.batchSize);

            batch.forEach(bookmark => {
                if (processed.has(bookmark.id)) return;

                const normalized = this.normalizeUrl(bookmark.url);
                if (normalized) {
                    if (!normalizedMap.has(normalized)) {
                        normalizedMap.set(normalized, []);
                    }
                    normalizedMap.get(normalized).push(bookmark);
                }
            });

            const progress = 50 + ((i / bookmarks.length) * 50);
            progressCallback?.(progress, `[PROCESSING] 正規化チェック: ${Math.min(i + this.settings.batchSize, bookmarks.length)}/${bookmarks.length}`);

            await this.delay(1);
        }

        this.processDuplicateGroups(normalizedMap, duplicates, processed, 'normalized');
    }

    processDuplicateGroups(urlMap, duplicates, processed, type) {
        for (const [url, bookmarks] of urlMap) {
            if (bookmarks.length > 1) {
                // 最新のものを除いて重複とする
                const sorted = bookmarks.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));

                for (let i = 1; i < sorted.length; i++) {
                    if (!processed.has(sorted[i].id)) {
                        duplicates.push({
                            ...sorted[i],
                            duplicateType: type,
                            keptBookmark: sorted[0],
                            groupSize: bookmarks.length
                        });
                        processed.add(sorted[i].id);
                    }
                }
            }
        }
    }

    normalizeUrl(url) {
        try {
            let normalized = url.toLowerCase().trim();

            // プロトコル正規化
            normalized = normalized.replace(/^https?:\/\//, 'https://');

            // www正規化
            normalized = normalized.replace(/^https:\/\/www\./, 'https://');

            // 末尾スラッシュ除去
            normalized = normalized.replace(/\/$/, '');

            // 基本的なクエリパラメータ除去（utm_*など）
            const url_obj = new URL(normalized);
            const searchParams = new URLSearchParams(url_obj.search);

            // 追跡パラメータを削除
            const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
            trackingParams.forEach(param => searchParams.delete(param));

            url_obj.search = searchParams.toString();
            return url_obj.toString();
        } catch {
            return url.toLowerCase().trim();
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// メインアプリケーション
class BookmarkDuplicateCleaner {
    constructor() {
        this.bookmarks = [];
        this.duplicates = [];
        this.detector = new DuplicateDetector();
        this.isProcessing = false;

        this.init();
    }

    async init() {
        try {
            await this.loadBookmarks();
            this.setupEventListeners();
            this.updateStats();
            console.log('[INFO] Bookmark Duplicate Cleaner  初期化完了');
        } catch (error) {
            console.error('[ERROR] 初期化エラー:', error);
            this.showAlert('error', '[ERROR] 初期化に失敗しました');
        }
    }

    async loadBookmarks() {
        try {
            const tree = await chrome.bookmarks.getTree();
            this.bookmarks = [];
            this.flattenBookmarks(tree);
            console.log(`[COMPLETE] ${this.bookmarks.length}個のブックマークを読み込み完了`);
        } catch (error) {
            console.error('[ERROR] ブックマーク読み込みエラー:', error);
            throw new Error('[ERROR] ブックマークの読み込みに失敗しました');
        }
    }

    flattenBookmarks(nodes, path = '') {
        nodes.forEach(node => {
            if (node.children) {
                const newPath = path ? `${path}/${node.title}` : node.title;
                this.flattenBookmarks(node.children, newPath);
            } else if (node.url && this.isValidUrl(node.url)) {
                this.bookmarks.push({
                    id: node.id,
                    title: node.title || 'タイトルなし',
                    url: node.url,
                    path: path,
                    dateAdded: node.dateAdded || 0
                });
            }
        });
    }

    isValidUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
            return false;
        }
    }

    setupEventListeners() {
        document.getElementById('scanButton').addEventListener('click', () => this.scanDuplicates());
        document.getElementById('previewButton').addEventListener('click', () => this.showPreview());
        document.getElementById('cleanButton').addEventListener('click', () => this.cleanDuplicates());
    }

    async scanDuplicates() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        this.duplicates = [];

        const button = document.getElementById('scanButton');
        const originalText = button.textContent;
        button.textContent = '[PROCESSING] スキャン中...';
        button.disabled = true;

        try {
            this.showProgress(true);

            const progressCallback = (progress, message) => {
                this.updateProgress(progress, message);
            };

            this.duplicates = await this.detector.detectDuplicates(this.bookmarks, progressCallback);

            this.showAlert('success', `[SUCCESS] スキャン完了。${this.duplicates.length}件の重複を発見しました`);
            this.displayResults();
            this.showActionButtons(this.duplicates.length > 0);

        } catch (error) {
            console.error('[ERROR] スキャンエラー:', error);
            this.showAlert('error', '[ERROR] スキャン中にエラーが発生しました');
        } finally {
            this.isProcessing = false;
            button.textContent = originalText;
            button.disabled = false;
            this.showProgress(false);
            this.updateStats();
        }
    }

    showPreview() {
        if (this.duplicates.length === 0) return;

        const modal = this.createPreviewModal();
        document.body.appendChild(modal);
    }

    createPreviewModal() {
        const modal = document.createElement('div');
        modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

        const content = document.createElement('div');
        content.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 20px;
      max-width: 500px;
      max-height: 80%;
      overflow-y: auto;
      color: black;
    `;

        content.innerHTML = `
      <h3 style="margin-bottom: 15px; color: #333;">削除予定のブックマーク</h3>
      <div style="max-height: 300px; overflow-y: auto; margin-bottom: 15px;">
        ${this.duplicates.slice(0, 20).map(dup => `
          <div style="padding: 8px; border-bottom: 1px solid #eee; font-size: 12px;">
            <div style="font-weight: bold;">${this.escapeHtml(dup.title)}</div>
            <div style="opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${this.escapeHtml(dup.url)}
            </div>
          </div>
        `).join('')}
        ${this.duplicates.length > 20 ? `<div style="text-align: center; padding: 10px; color: #666;">... 他 ${this.duplicates.length - 20} 件</div>` : ''}
      </div>
      <div style="text-align: right;">
        <button id="modalClose" style="padding: 8px 16px; margin-right: 10px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer;">キャンセル</button>
        <button id="modalConfirm" style="padding: 8px 16px; background: #ff6b6b; color: white; border: none; border-radius: 4px; cursor: pointer;">削除実行</button>
      </div>
    `;

        modal.appendChild(content);

        // イベントリスナー
        content.querySelector('#modalClose').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        content.querySelector('#modalConfirm').addEventListener('click', () => {
            document.body.removeChild(modal);
            this.performCleanup();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });

        return modal;
    }

    async cleanDuplicates() {
        if (this.duplicates.length === 0) {
            this.showAlert('warning', '[WARN] 削除対象の重複ブックマークがありません');
            return;
        }

        const confirmed = confirm(`${this.duplicates.length}個の重複ブックマークを削除しますか？\n\n※この操作は元に戻せません`);
        if (!confirmed) return;

        await this.performCleanup();
    }

    async performCleanup() {
        const button = document.getElementById('cleanButton');
        const originalText = button.textContent;
        button.textContent = '[PROCESSING] 削除中...';
        button.disabled = true;

        try {
            // 自動バックアップ作成
            await this.createBackup();

            let deletedCount = 0;
            const errors = [];

            for (const duplicate of this.duplicates) {
                try {
                    await chrome.bookmarks.remove(duplicate.id);
                    deletedCount++;
                } catch (error) {
                    errors.push(duplicate);
                    console.error(`[ERROR] 削除エラー [${duplicate.id}]:`, error);
                }
            }

            if (errors.length === 0) {
                this.showAlert('success', `[SUCCESS] ${deletedCount}個の重複ブックマークを削除しました`);
            } else {
                this.showAlert('warning', `[ERROR] ${deletedCount}個削除、${errors.length}個でエラーが発生しました`);
            }

            // 再スキャン
            await this.loadBookmarks();
            this.duplicates = [];
            this.displayResults();
            this.showActionButtons(false);

        } catch (error) {
            console.error('[ERROR] 削除エラー:', error);
            this.showAlert('error', '[ERROR] 削除中にエラーが発生しました');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
            this.updateStats();
        }
    }

    async createBackup() {
        try {
            const tree = await chrome.bookmarks.getTree();
            const backup = {
                timestamp: new Date().toISOString(),
                bookmarks: tree,
                version: '1.0.0'
            };

            await chrome.storage.local.set({
                [`backup_${Date.now()}`]: backup
            });

            console.log('[SUCCESS] バックアップ作成完了');
        } catch (error) {
            console.error('[ERROR] バックアップ作成エラー:', error);
        }
    }

    displayResults() {
        const container = document.getElementById('resultsSection');

        if (this.duplicates.length === 0) {
            container.innerHTML = '<div class="empty-state">[SUCCESS] 重複ブックマークは見つかりませんでした</div>';
            return;
        }

        let html = '';
        this.duplicates.slice(0, 10).forEach(duplicate => {
            html += `
        <div class="result-item">
          <div class="result-content">
            <div class="result-title">🔴 ${this.escapeHtml(duplicate.title)}</div>
            <div class="result-url">${this.escapeHtml(duplicate.url)}</div>
          </div>
        </div>
      `;
        });

        if (this.duplicates.length > 10) {
            html += `
        <div class="result-item">
          <div class="result-content" style="text-align: center; font-style: italic; opacity: 0.7;">
            ... 他 ${this.duplicates.length - 10} 件
          </div>
        </div>
      `;
        }

        container.innerHTML = html;
    }

    showActionButtons(show) {
        document.getElementById('actionButtons').style.display = show ? 'flex' : 'none';
    }

    showProgress(show) {
        document.getElementById('progressContainer').style.display = show ? 'block' : 'none';
        if (!show) {
            this.updateProgress(0, '');
        }
    }

    updateProgress(progress, message) {
        document.getElementById('progressFill').style.width = `${Math.min(100, Math.max(0, progress))}%`;
        document.getElementById('progressText').textContent = message;
    }

    showAlert(type, message) {
        const container = document.getElementById('alertContainer');
        const alert = document.createElement('div');
        alert.className = `alert ${type}`;
        alert.textContent = message;

        container.appendChild(alert);

        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 5000);
    }

    updateStats() {
        document.getElementById('totalCount').textContent = this.bookmarks.length;
        document.getElementById('duplicateCount').textContent = this.duplicates.length;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// アプリケーション開始
document.addEventListener('DOMContentLoaded', () => {
    new BookmarkDuplicateCleaner();
});
