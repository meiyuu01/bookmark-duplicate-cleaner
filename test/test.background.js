const BackgroundService = require('../background.js');

describe('BackgroundService', () => {
    let service;

    beforeEach(() => {
        service = new BackgroundService();
    });

    describe('validateBookmark', () => {
        test('有効なブックマークを通す', () => {
            const bookmark = {
                url: 'https://example.com',
                title: 'テストサイト'
            };
            expect(service.validateBookmark(bookmark)).toBe(true);
        });

        test('無効なURLを拒否', () => {
            const bookmark = {
                url: 'invalid-url',
                title: 'テストサイト'
            };
            expect(service.validateBookmark(bookmark)).toBe(false);
        });

        test('長すぎるタイトルを拒否', () => {
            const bookmark = {
                url: 'https://example.com',
                title: 'a'.repeat(1001)
            };
            expect(service.validateBookmark(bookmark)).toBe(false);
        });
    });

    describe('normalizeUrl', () => {
        test('URLを正規化', () => {
            const url = 'https://example.com/path?query=1';
            const normalized = service.normalizeUrl(url);
            expect(normalized).toBe('https://example.com/path');
        });

        test('無効なURLをそのまま返す', () => {
            const url = 'invalid-url';
            const normalized = service.normalizeUrl(url);
            expect(normalized).toBe('invalid-url');
        });
    });

    describe('findDuplicatesWithValidation', () => {
        test('重複ブックマークを検出', () => {
            const bookmarks = [
                { url: 'https://example.com', title: 'Site 1' },
                { url: 'https://example.com', title: 'Site 2' },
                { url: 'https://other.com', title: 'Other' }
            ];
            const duplicates = service.findDuplicatesWithValidation(bookmarks);
            expect(duplicates).toHaveLength(1);
            expect(duplicates[0]).toHaveLength(2);
        });
    });
});
