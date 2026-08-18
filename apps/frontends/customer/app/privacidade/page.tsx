export default function PrivacyPage() {
  return (
    <main className="privacy">
      <a href="/">← Início</a>
      <h1>Privacidade no cardápio digital</h1>
      <p>
        O cardápio pode ser consultado sem criar conta. Pedidos e chamados só são confirmados após
        aceite da operação; quando esse canal estiver indisponível, nenhum envio é apresentado como
        concluído.
      </p>
      <p>
        Solicitações de reserva e fila exigem nome, telefone e aceite explícito deste aviso. A
        validação pública de cupom é apenas uma estimativa e não consome o benefício. Delivery e
        retirada permanecem bloqueados até existir uma comanda operacional persistida; o saldo de
        fidelidade depende de prova de posse por OTP.
      </p>
      <p>
        <a href="/preferencias">Gerenciar preferências de comunicação</a>
      </p>
      <p>Este aviso é preliminar e será revisado antes do lançamento comercial.</p>
    </main>
  );
}
