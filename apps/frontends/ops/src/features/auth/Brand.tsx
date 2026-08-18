import { Button, Card } from "@giromesa/ui";
export function Brand() {
  return (
    <div className="brand" aria-label="GiroMesa" role="img">
      <span aria-hidden="true" className="brand__mark">
        G
      </span>
      <span>
        <strong>Giro</strong>Mesa
      </span>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <Brand />
      <span className="loading-spinner" />
      <strong>Validando sua sessão…</strong>
    </main>
  );
}

export function BootstrapError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="fatal-state">
      <Card>
        <span aria-hidden="true" className="action-icon action-icon--danger">
          !
        </span>
        <h1>Não foi possível iniciar o GiroMesa</h1>
        <p>{message}</p>
        <Button onClick={onRetry}>Tentar novamente</Button>
      </Card>
    </main>
  );
}
