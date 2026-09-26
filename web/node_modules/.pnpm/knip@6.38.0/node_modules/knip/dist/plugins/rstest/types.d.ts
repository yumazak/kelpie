export type RstestConfig = {
    include?: string[];
    exclude?: string[];
    testEnvironment?: 'node' | 'jsdom' | 'happy-dom' | {
        name: 'node' | 'jsdom' | 'happy-dom';
    };
    setupFiles?: string[];
};
