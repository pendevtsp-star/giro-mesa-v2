import { Button, Card } from "@giromesa/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { UiIcon } from "./ui-icon";

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
          <span aria-hidden="true" className="action-icon action-icon--danger">
            <UiIcon name="alert" />
          </span>
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
