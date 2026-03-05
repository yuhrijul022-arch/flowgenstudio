
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import { ToastProvider } from './src/components/ui/ToastProvider';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { UnifiedCheckoutComponent } from './src/components/UnifiedCheckoutComponent';
import { PaymentSuccess } from './src/components/PaymentSuccess';
import { PaymentPending } from './src/components/PaymentPending';
import { BillingPage } from './src/pages/BillingPage';
import { ErrorBoundary } from './src/components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={
              <AuthGate>
                {(user) => <App user={user} />}
              </AuthGate>
            } />
            <Route path="/formorder" element={<UnifiedCheckoutComponent />} />
            <Route path="/success" element={<PaymentSuccess />} />
            <Route path="/pending" element={<PaymentPending />} />
            <Route path="/billing" element={<BillingPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

