import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * Global Error Boundary — prevents blank screen crashes.
 * Shows a retry button instead of an empty page.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] App crashed:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    handleReload = () => {
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
                        Terjadi kendala pada aplikasi. Silakan coba lagi.
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
