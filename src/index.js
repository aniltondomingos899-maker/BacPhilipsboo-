require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error("Token do Telegram não configurado.");
    process.exit(1);
}

const bot = new TelegramBot(token, {
    polling: true
});

const DATABASE = "./data.json";

function carregarDados() {
    try {
        return JSON.parse(fs.readFileSync(DATABASE, "utf8"));
    } catch {
        return {
            resultados: []
        };
    }
}

function guardarDados(dados) {
    fs.writeFileSync(
        DATABASE,
        JSON.stringify(dados, null, 2)
    );
}

const nomes = {
    P: "PLAYER",
    B: "BANKER",
    T: "TIE"
};

function analisar(historico) {

    if (historico.length < 20) {
        return null;
    }

    const dados = historico.slice(-100);

    const pontuacao = {
        P: 0,
        B: 0,
        T: 0
    };

    // MODELO 1 — frequência
    const frequencia = {
        P: 0,
        B: 0,
        T: 0
    };

    dados.forEach(resultado => {
        frequencia[resultado]++;
    });

    for (const tipo of ["P", "B", "T"]) {
        pontuacao[tipo] +=
            (frequencia[tipo] / dados.length) * 0.25;
    }

    // MODELO 2 — resultados recentes
    const recentes = dados.slice(-12);

    const recentesContagem = {
        P: 0,
        B: 0,
        T: 0
    };

    recentes.forEach(resultado => {
        recentesContagem[resultado]++;
    });

    for (const tipo of ["P", "B", "T"]) {
        pontuacao[tipo] +=
            (recentesContagem[tipo] / recentes.length) * 0.25;
    }

    // MODELO 3 — transições
    const ultimo = dados[dados.length - 1];

    const transicoes = {
        P: 0,
        B: 0,
        T: 0
    };

    for (let i = 0; i < dados.length - 1; i++) {

        if (dados[i] === ultimo) {
            transicoes[dados[i + 1]]++;
        }
    }

    const totalTransicoes =
        transicoes.P +
        transicoes.B +
        transicoes.T;

    if (totalTransicoes > 0) {

        for (const tipo of ["P", "B", "T"]) {

            pontuacao[tipo] +=
                (transicoes[tipo] / totalTransicoes) * 0.20;
        }
    }

    // MODELO 4 — momentum
    const ultimaJanela = dados.slice(-6);
    const janelaAnterior = dados.slice(-24, -12);

    const atual = {
        P: 0,
        B: 0,
        T: 0
    };

    const anterior = {
        P: 0,
        B: 0,
        T: 0
    };

    ultimaJanela.forEach(x => atual[x]++);
    janelaAnterior.forEach(x => anterior[x]++);

    for (const tipo of ["P", "B", "T"]) {

        const atualPercentual =
            atual[tipo] / ultimaJanela.length;

        const anteriorPercentual =
            janelaAnterior.length
                ? anterior[tipo] / janelaAnterior.length
                : 0;

        const momentum =
            atualPercentual - anteriorPercentual;

        if (momentum > 0) {
            pontuacao[tipo] += momentum * 0.20;
        }
    }

    // Evita favorecer demasiado o TIE
    pontuacao.T *= 0.55;

    const ordem = ["P", "B", "T"].sort(
        (a, b) => pontuacao[b] - pontuacao[a]
    );

    const melhor = ordem[0];
    const segundo = ordem[1];

    const total =
        pontuacao.P +
        pontuacao.B +
        pontuacao.T;

    const confianca =
        (pontuacao[melhor] / total) * 100;

    const forca =
        ((pontuacao[melhor] -
            pontuacao[segundo]) / total) * 100;

    return {
        palpite: melhor,
        confianca,
        forca
    };
}

function backtest(historico) {

    let acertos = 0;
    let testes = 0;

    for (let i = 20; i < historico.length; i++) {

        const resultadoAnterior =
            historico.slice(0, i);

        const analise =
            analisar(resultadoAnterior);

        if (!analise) continue;

        testes++;

        if (
            analise.palpite ===
            historico[i]
        ) {
            acertos++;
        }
    }

    const taxa =
        testes > 0
            ? (acertos / testes) * 100
            : 0;

    return {
        acertos,
        testes,
        taxa
    };
}

function menu() {

    return {
        reply_markup: {
            inline_keyboard: [

                [
                    {
                        text: "🎯 NOVO PALPITE",
                        callback_data: "palpite"
                    }
                ],

                [
                    {
                        text: "📊 ANÁLISE",
                        callback_data: "analise"
                    },
                    {
                        text: "📜 HISTÓRICO",
                        callback_data: "historico"
                    }
                ],

                [
                    {
                        text: "🏆 DESEMPENHO",
                        callback_data: "desempenho"
                    }
                ],

                [
                    {
                        text: "➕ REGISTAR RESULTADO",
                        callback_data: "registar"
                    }
                ]
            ]
        }
    };
}

bot.onText(/\/start/, msg => {

    bot.sendMessage(
        msg.chat.id,

`◆ <b>BAC ANALYTICS</b>

Motor de análise estatística de Bac Bo.

🎯 Consenso de modelos
📊 Análise de sequência
📈 Backtest automático
🏆 Desempenho histórico

Escolhe uma opção abaixo:`,

        {
            parse_mode: "HTML",
            ...menu()
        }
    );
});

bot.onText(
    /\/resultado (player|banker|tie)/i,
    msg => {

        const dados = carregarDados();

        const texto =
            msg.text.toLowerCase();

        let resultado;

        if (texto.includes("player")) {
            resultado = "P";
        } else if (texto.includes("banker")) {
            resultado = "B";
        } else {
            resultado = "T";
        }

        dados.resultados.push(resultado);

        guardarDados(dados);

        bot.sendMessage(
            msg.chat.id,

`✅ <b>Resultado registado</b>

Resultado: <b>${nomes[resultado]}</b>
Rodadas guardadas: <b>${dados.resultados.length}</b>`,

            {
                parse_mode: "HTML"
            }
        );
    }
);

bot.onText(/\/palpite/, msg => {

    enviarPalpite(msg.chat.id);

});

function enviarPalpite(chatId) {

    const dados = carregarDados();

    const analise =
        analisar(dados.resultados);

    if (!analise) {

        bot.sendMessage(
            chatId,

`🎯 <b>CALIBRAÇÃO DO MODELO</b>

Ainda não existem dados suficientes.

Regista pelo menos <b>20 resultados</b> para ativar o motor de análise.`,

            {
                parse_mode: "HTML"
            }
        );

        return;
    }

    const desempenho =
        backtest(dados.resultados);

    bot.sendMessage(
        chatId,

`◆ <b>BAC ANALYTICS</b>

🎯 <b>PALPITE: ${nomes[analise.palpite]}</b>

📊 Confiança do modelo:
<b>${analise.confianca.toFixed(1)}%</b>

🔥 Força do consenso:
<b>${analise.forca.toFixed(1)}%</b>

📈 Assertividade histórica:
<b>${desempenho.taxa.toFixed(1)}%</b>

🧪 Rodadas analisadas:
<b>${dados.resultados.length}</b>

<b>Modelos:</b>
Frequência • Recentes • Transições • Momentum`,

        {
            parse_mode: "HTML"
        }
    );
}

bot.onText(/\/historico/, msg => {

    const dados = carregarDados();

    const historico =
        dados.resultados.slice(-30);

    if (!historico.length) {

        bot.sendMessage(
            msg.chat.id,
            "Ainda não existem resultados."
        );

        return;
    }

    const texto =
        historico
            .map(
                (x, i) =>
                    `${i + 1}. ${nomes[x]}`
            )
            .join("\n");

    bot.sendMessage(
        msg.chat.id,

`📜 <b>ÚLTIMAS RODADAS</b>

${texto}`,

        {
            parse_mode: "HTML"
        }
    );
});

bot.onText(/\/estatisticas/, msg => {

    const dados = carregarDados();

    const desempenho =
        backtest(dados.resultados);

    bot.sendMessage(
        msg.chat.id,

`🏆 <b>DESEMPENHO DO MOTOR</b>

Rodadas disponíveis:
<b>${dados.resultados.length}</b>

Palpites testados:
<b>${desempenho.testes}</b>

Acertos:
<b>${desempenho.acertos}</b>

Assertividade:
<b>${desempenho.taxa.toFixed(1)}%</b>`,

        {
            parse_mode: "HTML"
        }
    );
});

bot.on("callback_query", query => {

    bot.answerCallbackQuery(
        query.id
    );

    const chatId =
        query.message.chat.id;

    if (query.data === "palpite") {

        enviarPalpite(chatId);

    } else if (query.data === "historico") {

        bot.sendMessage(
            chatId,
            "Use /historico para consultar as últimas rodadas."
        );

    } else if (query.data === "desempenho") {

        bot.sendMessage(
            chatId,
            "Use /estatisticas para consultar o desempenho."
        );

    } else if (query.data === "analise") {

        enviarPalpite(chatId);

    } else if (query.data === "registar") {

        bot.sendMessage(
            chatId,

`➕ <b>REGISTAR RESULTADO</b>

Exemplo:

<code>/resultado player</code>

ou

<code>/resultado banker</code>

ou

<code>/resultado tie</code>`,

            {
                parse_mode: "HTML"
            }
        );
    }
});

console.log(
    "◆ BAC ANALYTICS — Telegram online"
);
