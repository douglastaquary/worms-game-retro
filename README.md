# Minhocas: Caos Tático

Demo jogável de artilharia por turnos, em visual lateral pintado à mão. Não é o Worms e não tem ligação com a Team17: os modelos, o mapa e o nome são originais, feitos para jogar no navegador.

Duas batalhas de campanha, com até 4 minhocas por time. O terreno se desfaz, a água afoga, o vento empurra o tiro e os prédios dão cobertura. A oficina entrega uma Mão Sagrada extra se a minhoca da vez estiver perto.

## Arsenal

- **Bazuca** — tiro direto. Arraste para mirar e solte, ou ajuste e toque em Fogo.
- **Mão Sagrada** — granada lenta, explosão larga.
- **Gorila Concreto** — marque o ponto e lance. Cai de cima.
- **Helicóptero** — marque o ponto. Três bombas.
- **Tanque** — chegue perto, entre, dirija com ◀ ▶ e dispare o canhão.

## Controles

Paisagem no celular. ◀ ▶ anda (ou dirige o tanque). Arrastar no campo mira a bazuca, a granada e o canhão. Teclado: A/D anda, setas ajustam o ângulo, W/S a força, espaço atira, 1–5 trocam a arma, Enter passa o turno, E sai do tanque.

## Local

```bash
npm install
npm run dev
```

Abre em `http://127.0.0.1:5188`.

## GitHub Pages

O build usa caminhos relativos (`base: './'`). O workflow `.github/workflows/pages.yml` publica a pasta `dist` no GitHub Pages quando o repositório recebe push em `main`.

No GitHub: Settings → Pages → Source: GitHub Actions. Depois do primeiro push na branch principal, a action gera o endereço da demo.
