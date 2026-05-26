import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

// Circuit Breaker compartilhado para a API Gemini (evita loops de erros 429 RESOURCE_EXHAUSTED)
let geminiBlockedUntil = 0;

// Validador abrangente de limites de cota para a API Gemini
function isQuotaError(error: any): boolean {
  if (!error) return false;
  const errStr = [
    error.message,
    error.status,
    error.statusText,
    error.error?.message,
    error.error?.status,
    String(error),
    JSON.stringify(error)
  ].filter(Boolean).join(" | ").toLowerCase();

  return (
    error.status === 429 ||
    error.error?.code === 429 ||
    errStr.includes("429") ||
    errStr.includes("resource_exhausted") ||
    errStr.includes("quota") ||
    errStr.includes("exceeded")
  );
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Configuração do multer para armazenamento em memória (limite estendido de 80MB para grandes carteiras de clientes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 80 * 1024 * 1024,
  }
});

// Inicialização segura do Cliente Gemini
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("A chave de API do Gemini (GEMINI_API_KEY) não está configurada nos Secrets da aplicação.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      }
    }
  });
}

// Classificação local de backup baseada nos primeiros dígitos do código CNAE e descrição de atividade
function classifySegmentLocally(cnaeCode: string, description: string = ""): string {
  const cleanDesc = (description || "").toLowerCase();
  
  if (
    cleanDesc.includes("software") || 
    cleanDesc.includes("tecnologia") || 
    cleanDesc.includes("computador") || 
    cleanDesc.includes("informação") || 
    cleanDesc.includes("ti") || 
    cleanDesc.includes("desenvolvimento de programa") ||
    cleanDesc.includes("provedor") ||
    cleanDesc.includes("dados")
  ) {
    return "Tecnologia / TI";
  }
  if (
    cleanDesc.includes("comércio") || 
    cleanDesc.includes("varejo") || 
    cleanDesc.includes("venda") || 
    cleanDesc.includes("atacadista") || 
    cleanDesc.includes("loja") || 
    cleanDesc.includes("supermercado") ||
    cleanDesc.includes("distribuidora") ||
    cleanDesc.includes("mercadorias")
  ) {
    return "Comércio";
  }
  if (
    cleanDesc.includes("indústria") || 
    cleanDesc.includes("fabricação") || 
    cleanDesc.includes("metalúrgico") || 
    cleanDesc.includes("produção") ||
    cleanDesc.includes("confecção") ||
    cleanDesc.includes("manufatura")
  ) {
    return "Indústria";
  }
  if (
    cleanDesc.includes("agricultura") || 
    cleanDesc.includes("pecuária") || 
    cleanDesc.includes("cultivo") || 
    cleanDesc.includes("fazenda") || 
    cleanDesc.includes("agronegócio") ||
    cleanDesc.includes("safra") ||
    cleanDesc.includes("colheita")
  ) {
    return "Agronegócio";
  }
  if (
    cleanDesc.includes("construção") || 
    cleanDesc.includes("edifício") || 
    cleanDesc.includes("obras") || 
    cleanDesc.includes("reforma") ||
    cleanDesc.includes("pintura") ||
    cleanDesc.includes("engenharia civil")
  ) {
    return "Construção Civil";
  }
  if (
    cleanDesc.includes("transporte") || 
    cleanDesc.includes("logística") || 
    cleanDesc.includes("carga") || 
    cleanDesc.includes("correio") || 
    cleanDesc.includes("fretamento") ||
    cleanDesc.includes("entrega")
  ) {
    return "Logística e Transportes";
  }
  if (
    cleanDesc.includes("banco") || 
    cleanDesc.includes("crédito") || 
    cleanDesc.includes("financeiro") || 
    cleanDesc.includes("investimento") || 
    cleanDesc.includes("seguro") ||
    cleanDesc.includes("cooperativa")
  ) {
    return "Financeiro";
  }
  if (
    cleanDesc.includes("escola") || 
    cleanDesc.includes("educação") || 
    cleanDesc.includes("ensino") || 
    cleanDesc.includes("curso") || 
    cleanDesc.includes("universidade") ||
    cleanDesc.includes("infantil")
  ) {
    return "Educação";
  }
  if (
    cleanDesc.includes("médico") || 
    cleanDesc.includes("hospital") || 
    cleanDesc.includes("saúde") || 
    cleanDesc.includes("clínica") || 
    cleanDesc.includes("odontológico") ||
    cleanDesc.includes("exames")
  ) {
    return "Saúde";
  }
  if (
    cleanDesc.includes("restaurante") || 
    cleanDesc.includes("alimento") || 
    cleanDesc.includes("refeição") || 
    cleanDesc.includes("lanchonete") || 
    cleanDesc.includes("padaria") ||
    cleanDesc.includes("buffet")
  ) {
    return "Serviços / Alimentação";
  }

  if (!cnaeCode) return "Serviços";
  const num = parseInt(cnaeCode.replace(/\D/g, "").substring(0, 2), 10);
  if (isNaN(num)) return "Serviços";

  if (num >= 1 && num <= 3) return "Agronegócio";
  if (num >= 5 && num <= 39) return "Indústria";
  if (num >= 41 && num <= 43) return "Construção Civil";
  if (num >= 45 && num <= 47) return "Comércio";
  if (num >= 49 && num <= 53) return "Logística e Transportes";
  if (num >= 55 && num <= 56) return "Serviços / Alimentação";
  if (num >= 58 && num <= 63) return "Tecnologia / TI";
  if (num >= 64 && num <= 66) return "Financeiro";
  if (num === 85) return "Educação";
  if (num >= 86 && num <= 88) return "Saúde";
  return "Serviços";
}

// Leitor local de segurança para extração de CNPJs via regex no buffer do PDF se a IA estiver sem cota (429)
function extractCnpjsFromBuffer(buffer: Buffer): string[] {
  try {
    // Apenas conversão para ASCII (CNPJ usa dígitos, pontos, barras e traços que estão no escopo ASCII).
    // Evita duplicar conversão e reduz drasticamente o consumo de memória e uso de CPU em arquivos pesados.
    const text = buffer.toString("ascii");
    
    // Expressão regular única para encontrar CNPJs estruturados ou simples
    const cnpjRegex = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g;
    const matches = text.match(cnpjRegex) || [];
    
    const rawSet = new Set<string>();
    
    for (let i = 0; i < matches.length; i++) {
      const clean = matches[i].replace(/\D/g, "");
      if (clean.length === 14) {
        rawSet.add(clean);
      }
      // Suporta extração de grandes volumes de clientes de forma segura e imediata
      if (rawSet.size >= 10000) break;
    }
    
    return Array.from(rawSet);
  } catch (err) {
    console.error("Erro no extrator local de segurança:", err);
    return [];
  }
}

// 1. Rota para análise de PDF e extração de lista de CNPJ com fallback local automático
app.post("/api/analyze-pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo PDF foi enviado." });
    }

    let cnpjs: string[] = [];
    let warning: string | undefined = undefined;

    // ALTA PERFORMANCE: Primeiro, extraímos CNPJs usando o extrator Regex local de alta velocidade.
    // Se encontrarmos mais que 25 CNPJs, ou se o arquivo for maior que 250 KB,
    // nós pulamos as chamadas da API do Gemini para evitar estourar o limite de tokens de saída da IA,
    // acelerar o processamento para milissegundos e economizar cota.
    const localExtracted = extractCnpjsFromBuffer(req.file.buffer);
    const fileBytes = req.file.buffer.length;

    if (localExtracted.length > 25 || fileBytes > 250 * 1024) {
      console.log(`[CNPJ API] Grande lote de registros detectado (${localExtracted.length} CNPJs, ${Math.round(fileBytes/1024)} KB). Processando via Extrator Local de Alta Performance.`);
      cnpjs = localExtracted;
      if (localExtracted.length > 25) {
        warning = `Grande lista comercial detectada (${localExtracted.length} clientes). Processamento local de alta performance ativado com sucesso em milissegundos.`;
      }
    } else {
      try {
        const ai = getGeminiClient();

        // Transforma o buffer em base64
        const pdfBase64 = req.file.buffer.toString("base64");

        const pdfPart = {
          inlineData: {
            mimeType: "application/pdf",
            data: pdfBase64,
          }
        };

        const promptText = `
          Analise detalhadamente este documento PDF. Identifique TODOS os CNPJs (Cadastro Nacional da Pessoa Jurídica) válidos contidos em qualquer parte do texto ou tabelas.
          
          Retorne estritamente uma lista em formato JSON contendo apenas os dígitos dos CNPJs encontrados (apenas números, 14 caracteres por elemento de string). Exemplo: ["12345678000100", "98765432000199"].
          Se você não encontrar nenhum CNPJ no documento, retorne uma lista vazia: []
          Não adicione qualquer outro texto explicativo fora do JSON.
        `;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: {
            parts: [
              pdfPart,
              { text: promptText }
            ]
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
                description: "Dígitos do CNPJ (apenas números, 14 caracteres)."
              }
            }
          }
        });

        const text = response.text || "[]";
        cnpjs = JSON.parse(text.trim());
        
        // Se a IA não identificar mas o local regex encontrou dados, mesclamos para não perder registros
        if (cnpjs.length === 0 && localExtracted.length > 0) {
          cnpjs = localExtracted;
        }
      } catch (aiError: any) {
        const isQuota = isQuotaError(aiError);
        if (isQuota) {
          console.warn("[CNPJ API] Limite de Cota Gemini [429] atingido ao ler PDF. Ativando Circuit Breaker de 10 minutos.");
          geminiBlockedUntil = Date.now() + 10 * 60 * 1000; // 10 minutos de pausa
        } else {
          console.warn("[CNPJ API] Falha ou limite de recursos ao chamar a API Gemini para ler PDF. Ativando extrator local alternativo de segurança...", aiError?.message || aiError);
        }
        
        // Fallback local robusto via Regex no arquivo binário em memória
        cnpjs = localExtracted;
        warning = isQuota
          ? "Sua cota de IA do Gemini foi excedida. Ativado mecanismo local de segurança para extração imediata e segura dos CNPJs."
          : "A API do Gemini está temporariamente indisponível. Ativado mecanismo local de segurança para extração imediata dos CNPJs.";
      }
    }

    // Limpeza rigorosa e eliminação de duplicatas
    cnpjs = cnpjs
      .map(c => c.replace(/\D/g, ""))
      .filter(c => c.length === 14);
    
    cnpjs = Array.from(new Set(cnpjs));

    return res.json({ cnpjs, warning });
  } catch (error: any) {
    console.error("Erro ao extrair CNPJs do PDF:", error);
    return res.status(500).json({ error: error.message || "Erro desconhecido ao ler o PDF." });
  }
});

// Cache em memória para busca de CNPJ (evita repetir consultas desnecessárias a APIs públicas ou Gemini)
const cnpjCache = new Map<string, any>();

// 2. Rota para busca integrada de CNPJ (com BrasilAPI público e fallback para Google Search)
app.post("/api/lookup-cnpj", async (req, res) => {
  try {
    const { cnpj } = req.body;
    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ é um parâmetro obrigatório." });
    }

    const cleanCnpj = cnpj.replace(/\D/g, "");
    if (cleanCnpj.length !== 14) {
      return res.status(400).json({ error: "CNPJ inválido. Precisa ter exatamente 14 dígitos de números." });
    }

    // Retorna do cache instantaneamente se já foi pesquisado nesta sessão
    if (cnpjCache.has(cleanCnpj)) {
      console.log(`[CNPJ API] Retornando dados em cache para: ${cleanCnpj}`);
      return res.json(cnpjCache.get(cleanCnpj));
    }

    const formattedCnpj = cleanCnpj.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5"
    );

    let resultInfo = {
      cnpj: cleanCnpj,
      cnpjFormatado: formattedCnpj,
      nomeCliente: "",
      cnae: "",
      descricaoCnae: "",
      segmento: "",
      origem: "unknown",
    };

    let apiSuccess = false;

    // 1º TENTATIVA: BRASIL API (Rápido, oficial)
    try {
      console.log(`[CNPJ API] Tentativa 1: Buscando ${cleanCnpj} via BrasilAPI...`);
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);
      if (response.ok) {
        const data: any = await response.json();
        resultInfo.nomeCliente = data.razao_social || data.nome_fantasia || "Não Informado";
        resultInfo.cnae = String(data.cnae_fiscal || "");
        resultInfo.descricaoCnae = data.cnae_fiscal_descricao || "Atividade principal não descrita";
        resultInfo.segmento = classifySegmentLocally(resultInfo.cnae, resultInfo.descricaoCnae);
        resultInfo.origem = "brasilapi";
        apiSuccess = true;
      }
    } catch (err: any) {
      console.warn(`[CNPJ API] Falha na tentativa 1 (BrasilAPI): ${err.message}`);
    }

    // 2º TENTATIVA: MINHA RECEITA (Espelho oficial da RFB, sem limites rigorosos)
    if (!apiSuccess) {
      try {
        console.log(`[CNPJ API] Tentativa 2: Buscando ${cleanCnpj} via Minha Receita...`);
        const response = await fetch(`https://minhareceita.org/${cleanCnpj}`);
        if (response.ok) {
          const data: any = await response.json();
          resultInfo.nomeCliente = data.razao_social || data.nome_fantasia || "Não Informado";
          resultInfo.cnae = String(data.cnae_fiscal || "");
          resultInfo.descricaoCnae = data.cnae_fiscal_descricao || "Atividade principal não descrita";
          resultInfo.segmento = classifySegmentLocally(resultInfo.cnae, resultInfo.descricaoCnae);
          resultInfo.origem = "brasilapi"; // Fonte de espelho confiável
          apiSuccess = true;
        }
      } catch (err: any) {
        console.warn(`[CNPJ API] Falha na tentativa 2 (Minha Receita): ${err.message}`);
      }
    }

    // 3º TENTATIVA: CNPJ.WS (API alternativa gratuita de dados públicos)
    if (!apiSuccess) {
      try {
        console.log(`[CNPJ API] Tentativa 3: Buscando ${cleanCnpj} via CNPJ.ws...`);
        const response = await fetch(`https://publica.cnpj.ws/cnpj/${cleanCnpj}`);
        if (response.ok) {
          const data: any = await response.json();
          resultInfo.nomeCliente = data.razao_social || data.estabelecimento?.nome_fantasia || "Não Informado";
          const principal = data.estabelecimento?.atividade_principal;
          resultInfo.cnae = String(principal?.id || "");
          resultInfo.descricaoCnae = principal?.descricao || "Atividade principal não descrita";
          resultInfo.segmento = classifySegmentLocally(resultInfo.cnae, resultInfo.descricaoCnae);
          resultInfo.origem = "brasilapi";
          apiSuccess = true;
        }
      } catch (err: any) {
        console.warn(`[CNPJ API] Falha na tentativa 3 (CNPJ.ws): ${err.message}`);
      }
    }

    // 4º TENTATIVA: RECEITAWS (Boa alternativa, limite de 3 requisições por minuto corporativo)
    if (!apiSuccess) {
      try {
        console.log(`[CNPJ API] Tentativa 4: Buscando ${cleanCnpj} via Receitaws...`);
        const response = await fetch(`https://receitaws.com.br/v1/cnpj/${cleanCnpj}`);
        if (response.ok) {
          const data: any = await response.json();
          if (data.status === "OK" || data.nome) {
            resultInfo.nomeCliente = data.nome || data.fantasia || "Não Informado";
            const principal = data.atividade_principal?.[0];
            resultInfo.cnae = String(principal?.code || "");
            resultInfo.descricaoCnae = principal?.text || "Atividade principal não descrita";
            resultInfo.segmento = classifySegmentLocally(resultInfo.cnae, resultInfo.descricaoCnae);
            resultInfo.origem = "brasilapi";
            apiSuccess = true;
          }
        }
      } catch (err: any) {
        console.warn(`[CNPJ API] Falha na tentativa 4 (Receitaws): ${err.message}`);
      }
    }

    // fallback final com inteligência artificial se as 4 APIs públicas diretas falharem completamente
    if (!apiSuccess) {
      // Verifica se o Circuit Breaker de IA está ativado
      if (Date.now() < geminiBlockedUntil) {
        console.warn(`[CNPJ API] Circuit Breaker ativo para Gemini. Pulando chamada do Google Search para ${cleanCnpj} para evitar erros 429.`);
        resultInfo.nomeCliente = `Empresa (${formattedCnpj})`;
        resultInfo.cnae = "Pendente";
        resultInfo.descricaoCnae = "Fim da cota de pesquisas com IA. Você pode clicar em 'Editar' para preencher os dados reais manualmente se desejar.";
        resultInfo.segmento = "Serviços";
        resultInfo.origem = "local_classification";
        
        cnpjCache.set(cleanCnpj, resultInfo);
        return res.json(resultInfo);
      }

      console.warn(`[CNPJ API] Todas as 4 APIs públicas falharam para o CNPJ ${cleanCnpj}. Ativando inteligência do Google Search / Econodata...`);

      try {
        const ai = getGeminiClient();
        const searchPrompt = `
          Pesquise na internet (com foco em Econodata, Google e portais de registro empresarial público) as informações cadastrais para o CNPJ: ${formattedCnpj} (apenas números: ${cleanCnpj}).
          
          Descubra com precisão:
          1. Razão Social ou Nome do cliente oficial.
          2. Código CNAE principal (ex: 6201-5/01, 6201501).
          3. Descrição correspondente do CNAE principal.
          4. O Segmento da empresa de maneira resumida (Indústria, Comércio, Serviços, Tecnologia, Agronegócio, Financeiro, Logística, Saúde, Educação, etc.).

          Preencha o JSON de retorno com extrema precisão, sem inventar valores se não encontrar correspondência direta nas pesquisas.
        `;

        const searchRes = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: searchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                nome_cliente: { type: Type.STRING, description: "Nome ou razão social" },
                cnae: { type: Type.STRING, description: "Código CNAE principal" },
                cnae_descricao: { type: Type.STRING, description: "Descrição do CNAE" },
                segmento: { type: Type.STRING, description: "Segmento geral da empresa (Comércio, Indústria, etc)" }
              },
              required: ["nome_cliente", "cnae", "cnae_descricao", "segmento"]
            }
          }
        });

        const searchObj = JSON.parse(searchRes.text?.trim() || "{}");
        resultInfo.nomeCliente = searchObj.nome_cliente || `Empresa (${formattedCnpj})`;
        resultInfo.cnae = searchObj.cnae || "Pendente";
        resultInfo.descricaoCnae = searchObj.cnae_descricao || "Consulta concluída.";
        resultInfo.segmento = searchObj.segmento || "Serviços";
        resultInfo.origem = "google_search";
      } catch (geminiSearchErr: any) {
        const isQuota = isQuotaError(geminiSearchErr);
        if (isQuota) {
          console.warn(`[CNPJ API] Limite de Cota Gemini [429] atingido ao pesquisar CNPJ ${cleanCnpj}. Ativando Circuit Breaker de 10 minutos.`);
          geminiBlockedUntil = Date.now() + 10 * 60 * 1000; // 10 minutos de pausa
          resultInfo.descricaoCnae = "Sua cota de pesquisa com IA do Gemini foi atingida. O sistema ativou o fallback de segurança automática para o resto da fila. Você pode preencher os dados reais clicando em 'Editar'.";
        } else {
          console.error(`[CNPJ API] Erro ao pesquisar CNPJ ${cleanCnpj} com Google Search (Gemini):`, geminiSearchErr?.message || geminiSearchErr);
          console.warn("[CNPJ API] Ativando Circuit Breaker preventivo por 2 minutos devido a erro de comunicação.");
          geminiBlockedUntil = Date.now() + 2 * 60 * 1000; // 2 minutos de pausa de segurança
          resultInfo.descricaoCnae = "A pesquisa rápida com IA está temporariamente indisponível. Você pode preencher os dados reais clicando em 'Editar'.";
        }

        // Em vez de retornar 404/500 que travaria o lote, nós de forma elegante retornamos
        // as informações locais básicas e marcamos para preenchimento manual se desejado!
        resultInfo.nomeCliente = `Empresa (${formattedCnpj})`;
        resultInfo.cnae = "Pendente";
        resultInfo.segmento = "Serviços";
        resultInfo.origem = "local_classification";
      }
    }

    // Salva no cache antes de retornar
    cnpjCache.set(cleanCnpj, resultInfo);
    return res.json(resultInfo);
  } catch (error: any) {
    console.error("Erro interno ao efetuar lookup do CNPJ:", error);
    return res.status(500).json({ error: error.message || "Erro interno do servidor." });
  }
});

// Middleware global de tratamento de erros para garantir respostas em formato JSON (evita quebrar o parser do cliente com HTML)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Global Error Handler] Erro capturado:", err);
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || "Ocorreu um erro inesperado no processamento do servidor."
  });
});

// Configuração do ambiente e inicialização do servidor Express + Vite
async function bootstrap() {
  // Integramos o Vite no desenvolvimento
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Modo de produção: servir arquivos estáticos compilados em /dist
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Full-Stack Server] Executando com sucesso em http://localhost:${PORT}`);
  });
}

bootstrap();
