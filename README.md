# MinhaTela

Compartilhamento unidirecional de tela com áudio via WebRTC. O Node.js serve o cliente e encaminha apenas mensagens de sinalização; vídeo e áudio são enviados diretamente entre os navegadores.

## Requisitos

- Node.js 20 ou mais recente.
- Chrome ou Edge atual recomendado para compartilhar a tela e áudio do sistema.
- Para captura, abra a página em `http://localhost` ou em um site HTTPS. Navegadores só permitem `getDisplayMedia` em contexto seguro.

## Iniciar no Windows

1. Abra o PowerShell nesta pasta.
2. Instale a dependência e inicie o servidor:

   ```powershell
   npm install
   npm start
   ```

3. No computador transmissor, abra `http://localhost:3000`.
4. Mantenha o código de sala gerado ou substitua-o por outro e clique em **Compartilhar tela**.
5. Escolha uma tela ou janela no seletor do navegador. Para enviar áudio do sistema, habilite **Compartilhar áudio** no próprio seletor, quando essa opção estiver disponível.
6. Nos computadores espectadores, abra `http://IP-DO-PC:3000` se estiverem na mesma rede local, informe o mesmo código e clique em **Assistir**. O Firewall do Windows pode pedir autorização para Node.js; permita acesso à rede privada.
7. Clique em **Encerrar sessão** ou pare o compartilhamento para fechar as conexões e liberar as capturas.

Para descobrir o IP local no Windows, execute `ipconfig` e use o endereço IPv4 da rede ativa. Também é possível iniciar em outra porta com `$env:PORT=3001; npm start`.

## Limites de rede e privacidade

- A tela e o áudio não passam pelo servidor de sinalização. A conexão WebRTC usa criptografia DTLS-SRTP e tenta conectar os navegadores diretamente; a configuração incluída usa STUN público para descobrir caminhos de rede.
- STUN não retransmite mídia. Redes restritivas, CGNAT ou certos roteadores podem impedir a conexão direta; para uso pela internet pode ser necessário adicionar um servidor TURN próprio e configurar HTTPS/WSS e encaminhamento de portas. Não exponha este servidor HTTP simples diretamente à internet.
- O código da sala funciona como segredo de acesso, mas qualquer pessoa que o conheça pode assistir. Gere um código novo para cada sessão e compartilhe-o apenas com os amigos pretendidos.
- Firefox pode assistir a uma transmissão com áudio, mas não oferece captura de áudio de sistema por `getDisplayMedia`. Para transmitir com áudio, use Chrome ou Edge desktop e habilite **Compartilhar áudio** no seletor; a disponibilidade ainda depende da origem escolhida e do sistema operacional.
- Para jogos, escolha uma taxa/resolução compatível com a máquina e a rede. `getDisplayMedia` deixa a escolha final de captura para o navegador; 60 fps é uma preferência, não uma garantia. O desempenho também depende de codificação de vídeo por hardware e da rede entre os pares.
- Esta versão suporta um transmissor e até oito espectadores por sala. O transmissor cria uma conexão P2P separada para cada espectador, então o upload e a codificação crescem com o número deles.