global.chrome = {
    bookmarks: {
        getTree: jest.fn(),
        onCreated: { addListener: jest.fn() },
        onRemoved: { addListener: jest.fn() }
    },
    runtime: {
        onInstalled: { addListener: jest.fn() },
        onMessage: { addListener: jest.fn() }
    },
    storage: {
        local: {
            get: jest.fn(),
            set: jest.fn()
        }
    }
};
