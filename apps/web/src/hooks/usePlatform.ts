import { useState, useEffect } from 'react';

export type Platform = 'web' | 'desktop' | 'mobile';

export function usePlatform(): Platform {
    const [platform, setPlatform] = useState<Platform>('web');

    useEffect(() => {
        // Check if running in Tauri
        if (typeof window !== 'undefined' && '__TAURI__' in window) {
            setPlatform('desktop');
            return;
        }

        // Check for mobile user agent
        const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
        if (isMobile) {
            setPlatform('mobile');
            return;
        }

        setPlatform('web');
    }, []);

    return platform;
}

export function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}

export function isWeb(): boolean {
    return !isTauri();
}
