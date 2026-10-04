# MinhaTela

MinhaTela compartilha tela e áudio de captura e oferece voz P2P, chat, participantes e ferramentas visuais. O Node.js serve o cliente e encaminha sinalização/eventos da sala; áudio e vídeo WebRTC seguem diretamente entre os navegadores.

## Requisitos

- Node.js 20 ou mais recente.
- Chrome ou Edge atual recomendado para compartilhar a tela e áudio do sistema.
- Para captura, abra a página em `http://localhost` ou em um site HTTPS. Navegadores só permitem `getDisplayMedia` em contexto seguro.
- O microfone só é solicitado após clicar em **Microfone desligado**; a seleção de entrada depende do suporte do navegador e do sistema.

## Iniciar no Windows

1. Abra o PowerShell nesta pasta.
2. Instale a dependência e inicie o servidor:

   ```powershell
   npm install
   npm start
   ```

3. No computador transmissor, abra `http://localhost:3000`.
4. Defina seu nome e mantenha o código de sala gerado ou substitua-o por outro. Códigos existentes continuam aceitando 4 a 40 letras, números, hífen ou sublinhado.
5. Escolha uma tela ou janela no seletor do navegador. Para enviar áudio do sistema, habilite **Compartilhar áudio** no próprio seletor, quando essa opção estiver disponível.
6. Nos computadores espectadores, abra `http://IP-DO-PC:3000` se estiverem na mesma rede local, informe o mesmo código e clique em **Assistir**. O Firewall do Windows pode pedir autorização para Node.js; permita acesso à rede privada.
7. Ative o microfone em cada participante que quiser falar. Use o seletor de entrada, o volume individual, o chat e as ferramentas visuais durante a sala.
8. Clique em **Encerrar sessão** ou pare o compartilhamento para fechar as conexões e liberar as capturas.

Para descobrir o IP local no Windows, execute `ipconfig` e use o endereço IPv4 da rede ativa. Também é possível iniciar em outra porta com `$env:PORT=3001; npm start`.

## Testes

Execute `npm test` para validar o JavaScript inline e testar o servidor HTTP/WebSocket, incluindo ingresso em sala, chat, sinalização mesh e validação de eventos.

## Limites de rede e privacidade

- A tela e o áudio não passam pelo servidor de sinalização. A conexão WebRTC usa criptografia DTLS-SRTP e tenta conectar os navegadores diretamente; a configuração incluída usa STUN público para descobrir caminhos de rede.
- STUN não retransmite mídia. Redes restritivas, CGNAT ou certos roteadores podem impedir a conexão direta; configure externamente um provedor TURN com credenciais temporárias apropriadas. Não coloque um segredo TURN permanente no frontend ou no repositório. TURN não vem configurado por padrão.
- O código da sala funciona como segredo de acesso, mas qualquer pessoa que o conheça pode assistir. Gere um código novo para cada sessão e compartilhe-o apenas com os amigos pretendidos.
- Firefox pode assistir a uma transmissão com áudio, mas não oferece captura de áudio de sistema por `getDisplayMedia`. Para transmitir com áudio, use Chrome ou Edge desktop e habilite **Compartilhar áudio** no seletor; a disponibilidade ainda depende da origem escolhida e do sistema operacional.
- O servidor suporta um transmissor e até oito espectadores. A voz usa mesh P2P e a tela cria um fluxo por espectador; o custo de CPU/rede cresce com o número de participantes. Destinado a salas pequenas.
- Chat e estado ficam em memória, sem histórico. A sala temporária some quando todos saem ou o processo reinicia. O cliente tenta reconectar com intervalos progressivos e reentra usando o mesmo código, mas não recupera mensagens perdidas durante a queda.
- No Render Free, o serviço suspende após 15 minutos sem tráfego de entrada e pode levar cerca de um minuto para voltar. Sessões podem cair; a reconexão é limitada e depois oferece **Retomar sessão**. O plano gratuito não mantém o serviço permanentemente ativo.
- Ping/pong está disponível com `WS_HEARTBEAT=1` para hospedagens persistentes. Fica desligado por padrão para não produzir atividade periódica que interfira na suspensão do Render Free.
- As estatísticas WebRTC ajustam o bitrate quando suportado e mostram RTT/perda aproximados quando disponíveis. `getDisplayMedia` ainda deixa a resolução/taxa final a cargo do navegador; 60 fps é apenas uma preferência.
- Atalhos: `Alt+Shift+M` alterna microfone, `Alt+Shift+T` alterna teatro, `Alt+Shift+F` alterna tela cheia e `Alt+Shift+C` minimiza controles; não atuam enquanto um campo ou seletor está focado.