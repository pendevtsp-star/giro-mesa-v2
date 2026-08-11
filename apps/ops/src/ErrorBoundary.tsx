import { Button, Card, Icon } from "@giromesa/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("GiroMesa UI failure", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-state">
        <Card>
          <Icon className="action-icon action-icon--danger" name="alert" />
          <h1>Não foi possível exibir esta tela</h1>
          <p>
            Seus comandos já registrados continuam preservados. Recarregue para tentar novamente.
          </p>
          <Button onClick={() => window.location.reload()}>Recarregar operação</Button>
        </Card>
      </main>
    );
  }
}
