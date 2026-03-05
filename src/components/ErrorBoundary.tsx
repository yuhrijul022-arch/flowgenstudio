import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    autoReloading: boolean;
}

/**
 * Global Error Boundary — prevents blank screen crashes.
 * Shows a retry UI and auto-reloads after 2 seconds.
 */
export class ErrorBoundary extends Component<Props, State> {
    private reloadTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, autoReloading: false };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] App crashed:', error, errorInfo);

        // Auto-reload after 2 seconds
        this.reloadTimer = setTimeout(() => {
            this.setState({ autoReloading: true });
            window.location.reload();
        }, 2000);
    }

    componentWillUnmount() {
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
        }
    }

    handleRetry = () => {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.setState({ hasError: false, error: null, autoReloading: false });
    };

    handleReload = () => {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '100vh',
                    background: '#0a0a0a',
                    color: '#ffffff',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    padding: '20px',
                    textAlign: 'center',
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                    <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
                        Terjadi Kesalahan
                    </h2>
                    <p style={{ color: '#888', fontSize: '14px', marginBottom: '24px', maxWidth: '400px' }}>
                        {this.state.autoReloading
                            ? 'Memuat ulang aplikasi...'
                            : 'Terjadi kendala pada aplikasi. Memuat ulang otomatis dalam 2 detik...'}
                    </p>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={this.handleRetry}
                            style={{
                                padding: '10px 24px',
                                borderRadius: '8px',
                                border: '1px solid #333',
                                background: '#1a1a1a',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: '14px',
                            }}
                        >
                            Coba Lagi
                        </button>
                        <button
                            onClick={this.handleReload}
                            style={{
                                padding: '10px 24px',
                                borderRadius: '8px',
                                border: 'none',
                                background: '#fff',
                                color: '#000',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 600,
                            }}
                        >
                            Muat Ulang
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
