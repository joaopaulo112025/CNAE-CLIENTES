import React, { useState, useRef } from "react";
import { 
  FileText, 
  UploadCloud, 
  Search, 
  Play, 
  Plus, 
  Trash2, 
  FileDown, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Building2, 
  AlertCircle,
  Hash,
  HelpCircle,
  Layers,
  FileCheck,
  AlertTriangle,
  ExternalLink
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { CNPJInfo } from "./types";

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [cookieBlocked, setCookieBlocked] = useState(false);
  
  // Lista de CNPJs cadastrados para processamento e seus respectivos status
  const [cnpjList, setCnpjList] = useState<CNPJInfo[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Paginação de alta performance para lidar com milhares de CNPJs de forma ultra responsiva
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Reseta para a primeira página automaticamente ao filtrar ou alterar a quantidade de itens
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, cnpjList.length]);

  // Nome do anexo ou arquivo atual para identificar no histórico
  const [currentFileName, setCurrentFileName] = useState<string>("");
  
  // Lista de arquivos processados salvos no histórico
  interface HistoryRecord {
    fileName: string;
    processedAt: string;
    items: CNPJInfo[];
  }
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);

  // Carrega histórico do localStorage ao iniciar
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem("cnpj_validator_history_v2");
      if (stored) {
        setHistoryRecords(JSON.parse(stored));
      }
    } catch (err) {
      console.error("Erro ao ler histórico de arquivos:", err);
    }
  }, []);

  // Salva ou atualiza um registro no histórico
  const saveToHistory = (fileName: string, items: CNPJInfo[]) => {
    if (!fileName || items.length === 0) return;
    
    setHistoryRecords(prev => {
      const timestamp = new Date().toLocaleString("pt-BR");
      const existingIdx = prev.findIndex(r => r.fileName === fileName);
      let updated: HistoryRecord[];
      
      if (existingIdx >= 0) {
        updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          processedAt: timestamp,
          items: items
        };
      } else {
        updated = [
          {
            fileName,
            processedAt: timestamp,
            items: items
          },
          ...prev
        ];
      }
      
      localStorage.setItem("cnpj_validator_history_v2", JSON.stringify(updated));
      return updated;
    });
  };

  // Efeito automático para salvar modificações no histórico do arquivo atual à medida que ocorrem
  React.useEffect(() => {
    if (currentFileName && cnpjList.length > 0) {
      saveToHistory(currentFileName, cnpjList);
    }
  }, [cnpjList, currentFileName]);

  const handleLoadHistory = (record: HistoryRecord) => {
    setCnpjList(record.items);
    setCurrentFileName(record.fileName);
    // Cria um arquivo virtual fictício para preencher o estado selecionado visualmente
    setSelectedFile(new File([], record.fileName, { type: "application/pdf" }));
    addLog(`Histórico carregado para o arquivo: "${record.fileName}" (${record.items.length} CNPJs)`);
  };

  const handleDeleteHistoryRecord = (fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Deseja apagar o histórico do arquivo "${fileName}"?`)) {
      setHistoryRecords(prev => {
        const updated = prev.filter(r => r.fileName !== fileName);
        localStorage.setItem("cnpj_validator_history_v2", JSON.stringify(updated));
        return updated;
      });
      addLog(`Histórico do arquivo "${fileName}" excluído.`);
      
      if (currentFileName === fileName) {
        setCnpjList([]);
        setSelectedFile(null);
        setCurrentFileName("");
      }
    }
  };

  // Estados para edição manual em linha (essenciais para contornar qualquer erro de cota ou rate-limit da internet)
  const [editingCnpj, setEditingCnpj] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    nomeCliente: string;
    segmento: string;
    cnae: string;
    descricaoCnae: string;
  }>({
    nomeCliente: "",
    segmento: "",
    cnae: "",
    descricaoCnae: ""
  });

  const handleStartEdit = (item: CNPJInfo) => {
    setEditingCnpj(item.cnpj);
    setEditForm({
      nomeCliente: item.nomeCliente || "",
      segmento: item.segmento || "Serviços",
      cnae: item.cnae || "",
      descricaoCnae: item.descricaoCnae || ""
    });
    addLog(`Iniciada modificação manual para o CNPJ ${item.cnpjFormatado}.`);
  };

  const handleSaveEdit = (index: number) => {
    setCnpjList(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        status: "success", // Tratado como sucesso para validado no relatório PDF
        nomeCliente: editForm.nomeCliente || "Empresa sob Medida",
        segmento: editForm.segmento || "Serviços",
        cnae: editForm.cnae || "-",
        descricaoCnae: editForm.descricaoCnae || "-",
        origem: "unknown" // Customizado pelo operador
      };
      return updated;
    });
    setEditingCnpj(null);
    addLog(`Sucesso: Dados atualizados manualmente para o CNPJ ${cnpjList[index].cnpjFormatado}.`);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Adiciona logs de depuração para guiar o usuário na interface
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 49)]);
  };

  // Drag-and-Drop Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/pdf") {
        setSelectedFile(file);
        setCurrentFileName(file.name);
        addLog(`Arquivo PDF selecionado por arrasto: "${file.name}"`);
      } else {
        addLog("Erro: O arquivo enviado não é um PDF válido.");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === "application/pdf") {
        setSelectedFile(file);
        setCurrentFileName(file.name);
        addLog(`Arquivo PDF selecionado: "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        addLog("Erro: O arquivo selecionado precisa ser de formato PDF.");
      }
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  // Solicita autorização de armazenamento de cookies ao navegador para resolver o bloqueio em Iframe (Safari/Chrome Incognito)
  const handleRequestStorageAccess = async () => {
    try {
      if (typeof document !== "undefined" && (document as any).requestStorageAccess) {
        await (document as any).requestStorageAccess();
        addLog("Cookies autorizados com sucesso pelo navegador! Recarregando aplicação...");
        window.location.reload();
      } else {
        alert("Seu navegador não oferece suporte nativo para habilitar acesso a cookies neste iframe. Por favor, utilize o botão 'Abrir em Nova Aba'!");
      }
    } catch (err: any) {
      console.warn("Navegador negou ou bloqueou o requestStorageAccess:", err);
      alert("Não foi possível autorizar automaticamente os cookies no iframe (comum em abas anônimas ou navegadores restritos). Por favor, clique em 'Abrir em Nova Aba' para prosseguir de forma segura.");
    }
  };

  // Envia o PDF ao Express Backend para extração de CNPJs usando o Gemini
  const handleScanPDF = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    addLog(`Enviando "${selectedFile.name}" ao servidor para leitura de CNPJs com IA...`);

    const formData = new FormData();
    formData.append("pdf", selectedFile);

    try {
      const response = await fetch("/api/analyze-pdf", {
        method: "POST",
        body: formData,
      });

      const responseText = await response.text();

      if (responseText.includes("Cookie check") || responseText.includes("Action required to load your app") || responseText.includes("__SECURE-aistudio")) {
        setCookieBlocked(true);
        throw new Error("O seu navegador bloqueou cookies de segurança automática. Por favor, clique na recomendação em amarelo no topo da página 'Abrir em Nova Aba' para prosseguir de forma segura.");
      }

      let errorMsg = "Erro de rede ao analisar o PDF.";
      if (!response.ok) {
        try {
          const errData = JSON.parse(responseText);
          errorMsg = errData.error || errorMsg;
        } catch {
          errorMsg = `Erro do servidor (${response.status}): ${responseText.substring(0, 150)}`;
        }
        throw new Error(errorMsg);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (jsonErr) {
        console.error("[Parser Cliente] Resposta recebida:", responseText);
        throw new Error(`A resposta de análise do PDF não pôde ser interpretada como JSON. Detalhes: ${responseText.substring(0, 100)}...`);
      }

      if (data.warning) {
        addLog(`[AVISO] ${data.warning}`);
      }

      const extractedCnpjs: string[] = data.cnpjs || [];

      if (extractedCnpjs.length === 0) {
        addLog("IA processou o PDF, mas nenhum CNPJ válido foi identificado.");
        alert("O documento PDF foi lido, mas nenhum CNPJ estruturado foi encontrado.");
      } else {
        addLog(`Sucesso: ${extractedCnpjs.length} CNPJs únicos encontrados no PDF.`);
        
        // Cria nova lista limpa de CNPJs correspondentes ao arquivo
        const newItems: CNPJInfo[] = [];

        extractedCnpjs.forEach((cnpjString: string) => {
          const clean = cnpjString.replace(/\D/g, "");
          if (clean.length === 14) {
            const formatted = clean.replace(
              /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
              "$1.$2.$3/$4-$5"
            );
            if (!newItems.some(item => item.cnpj === clean)) {
              newItems.push({
                cnpj: clean,
                cnpjFormatado: formatted,
                status: "pending",
                nomeCliente: "Aguardando busca...",
                cnae: "Não consultado",
                descricaoCnae: "Não consultado",
                segmento: "Pendente",
                origem: "unknown",
              });
            }
          }
        });

        if (newItems.length > 0) {
          setCnpjList(newItems);
          addLog(`${newItems.length} CNPJs identificados no PDF atual e carregados para triagem.`);
        } else {
          addLog("Nenhum CNPJ estruturado foi localizado no PDF.");
        }
      }
    } catch (error: any) {
      console.error(error);
      addLog(`Erro na inteligência do PDF: ${error.message}`);
      alert(`Falha ao ler o PDF: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Adiciona CNPJ via entrada manual
  const handleAddManualCnpj = () => {
    const rawVal = manualInput.trim();
    if (!rawVal) return;

    // Remove tudo o que não for número
    const clean = rawVal.replace(/\D/g, "");
    if (clean.length !== 14) {
      addLog("Erro: Um CNPJ brasileiro deve conter exatamente 14 números.");
      alert("CNPJ inválido. Digite 14 números.");
      return;
    }

    // Evita duplicatas na lista de trabalho
    if (cnpjList.some(item => item.cnpj === clean)) {
      addLog(`Erro: CNPJ ${clean} já listado.`);
      alert("Este CNPJ já está cadastrado.");
      return;
    }

    const formatted = clean.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5"
    );

    const newItem: CNPJInfo = {
      cnpj: clean,
      cnpjFormatado: formatted,
      status: "pending",
      nomeCliente: "Inserido manualmente",
      cnae: "-",
      descricaoCnae: "-",
      segmento: "-",
      origem: "unknown",
    };

    if (!currentFileName && !selectedFile) {
      const dateStr = new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
      setCurrentFileName(`Lista_Manual_${dateStr}`);
    }

    setCnpjList(prev => [...prev, newItem]);
    setManualInput("");
    addLog(`CNPJ ${formatted} inserido manualmente na fila.`);
  };

  // Realiza a busca detalhada de um CNPJ único no backend (BrasilAPI + Google Search IA Grounding)
  const lookupSingleCNPJ = async (targetIndex: number) => {
    const item = cnpjList[targetIndex];
    if (!item) return;

    addLog(`Iniciando investigação online para o CNPJ ${item.cnpjFormatado}...`);
    
    // Atualiza status local para 'calculando'
    updateItemState(targetIndex, { status: "searching", nomeCliente: "Pesquisando internet..." });

    try {
      const response = await fetch("/api/lookup-cnpj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: item.cnpj })
      });

      const responseText = await response.text();

      if (responseText.includes("Cookie check") || responseText.includes("Action required to load your app") || responseText.includes("__SECURE-aistudio")) {
        setCookieBlocked(true);
        throw new Error("O seu navegador bloqueou cookies de segurança automática. Por favor, clique na recomendação em amarelo no topo da página 'Abrir em Nova Aba' para prosseguir de forma segura.");
      }

      let errorMsg = "Pesquisa retornou erro do servidor.";
      if (!response.ok) {
        try {
          const errData = JSON.parse(responseText);
          errorMsg = errData.error || errorMsg;
        } catch {
          errorMsg = `Erro do servidor (${response.status}): ${responseText.substring(0, 150)}`;
        }
        throw new Error(errorMsg);
      }

      let lookupResult;
      try {
        lookupResult = JSON.parse(responseText);
      } catch (jsonErr) {
        console.error("[Parser Cliente Lookup] Resposta recebida:", responseText);
        throw new Error(`Resposta inválida do servidor de consulta (JSON corrompido). Detalhes: ${responseText.substring(0, 100)}...`);
      }
      
      addLog(`Sucesso: CNPJ ${item.cnpjFormatado} identificado como: "${lookupResult.nomeCliente}" (${lookupResult.segmento})`);

      updateItemState(targetIndex, {
        status: "success",
        nomeCliente: lookupResult.nomeCliente,
        cnae: lookupResult.cnae,
        descricaoCnae: lookupResult.descricaoCnae,
        segmento: lookupResult.segmento,
        origem: lookupResult.origem,
      });
    } catch (err: any) {
      console.error(err);
      addLog(`Erro buscando CNPJ ${item.cnpjFormatado}: ${err.message}`);
      updateItemState(targetIndex, {
        status: "failed",
        nomeCliente: "Falha na busca online",
        error: err.message,
        segmento: "Sem Segmento",
        cnae: "Indisponível",
        descricaoCnae: "Não localizado nas buscas"
      });
    }
  };

  // Inicia o processamento concorrente e inteligente (com limite de cota / circuito breaker no back-end)
  const startBatchProcessing = async () => {
    const pendingsIndexes = cnpjList
      .map((item, index) => (item.status === "pending" || item.status === "failed" ? index : -1))
      .filter(index => index !== -1);

    if (pendingsIndexes.length === 0) {
      addLog("Nenhum CNPJ elegível para busca na lista.");
      return;
    }

    setIsProcessingAll(true);
    addLog(`Processando fila de alta velocidade: ${pendingsIndexes.length} CNPJ(s) serão analisados em paralelo...`);

    // Processamento de alta concorrência: dividimos o processamento em 10 trabalhadores paralelos.
    // Isso reduz o tempo para listas com 5.500 registros de horas para poucos minutos de forma segura!
    const concurrencyLimit = 10;
    let nextIndexPtr = 0;

    const worker = async () => {
      while (true) {
        // Obtenção atômica do próximo índice para processar
        const currentIndex = nextIndexPtr++;
        if (currentIndex >= pendingsIndexes.length) {
          break;
        }
        
        const targetIndex = pendingsIndexes[currentIndex];
        try {
          await lookupSingleCNPJ(targetIndex);
        } catch (e: any) {
          console.error("Erro interno no trabalhador paralelos:", e);
        }

        // Espaçamento curto entre requisições de 155ms por trabalhador para balanceamento de rede polido
        await new Promise(resolve => setTimeout(resolve, 155));
      }
    };

    const workers = [];
    const activeConcurrency = Math.min(concurrencyLimit, pendingsIndexes.length);
    for (let i = 0; i < activeConcurrency; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    setIsProcessingAll(false);
    addLog("Processamento simultâneo em lote finalizado com sucesso.");
  };

  // Helper para atualizar o estado de um determinado CNPJ
  const updateItemState = (index: number, fieldsToUpdate: Partial<CNPJInfo>) => {
    setCnpjList(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...fieldsToUpdate };
      return updated;
    });
  };

  // Remove item da lista de trabalho
  const handleRemoveItem = (index: number) => {
    const target = cnpjList[index];
    setCnpjList(prev => prev.filter((_, i) => i !== index));
    addLog(`CNPJ ${target.cnpjFormatado} removido da lista.`);
  };

  // Limpa todos os registros
  const handleClearAll = () => {
    if (window.confirm("Deseja apagar todos os CNPJs e limpar a tabela?")) {
      setCnpjList([]);
      setSelectedFile(null);
      setCurrentFileName("");
      setLogs([]);
      addLog("Painel de trabalho redefinido e lista reiniciada.");
    }
  };

  // Geração e download do relatório em PDF (Cliente, CNPJ, CNAE Principal e Descrição CNAE)
  const handleExportPDF = () => {
    const elementsToExport = cnpjList.filter(item => item.status === "success");
    if (elementsToExport.length === 0) {
      alert("Nenhum CNPJ com dados buscados com sucesso para exportar. Por favor, pesquise os dados primeiro!");
      return;
    }

    addLog(`Iniciando geração de relatório oficial em PDF com ${elementsToExport.length} itens...`);

    const doc = new jsPDF("l", "mm", "a4"); // Landscape orient para caber as descrições elegantemente
    
    // Título e Cabeçalhos Visuais
    doc.setFillColor(15, 23, 42); // Slate-900
    doc.rect(0, 0, 297, 30, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Relatório de CNPJs e CNAEs Encontrados", 15, 12);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 210);
    doc.text(`Documento gerado automaticamente em ${new Date().toLocaleDateString("pt-BR")} | Total de empresas: ${elementsToExport.length}`, 15, 22);

    const rows = elementsToExport.map(item => [
      item.nomeCliente,
      item.cnpjFormatado,
      item.cnae,
      item.descricaoCnae
    ]);

    autoTable(doc, {
      startY: 38,
      head: [["Nome / Razão Social do Cliente", "CNPJ", "CNAE Principal", "Descrição do CNAE"]],
      body: rows,
      theme: "striped",
      styles: {
        font: "helvetica",
        fontSize: 9, 
        cellPadding: 4,
      },
      headStyles: {
        fillColor: [30, 41, 59], // Slate-800
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 85 }, // Razão Social ampliada
        1: { cellWidth: 42 }, // CNPJ
        2: { cellWidth: 30 }, // CNAE
        3: { cellWidth: 110 }, // Descricao
      },
      margin: { left: 15, right: 15 },
      didDrawPage: (data) => {
        // Rodapé do PDF
        const str = `Página ${data.pageNumber} de ${data.pageNumber}`;
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(str, 297 - 35, 200);
      }
    });

    doc.save("Relatorio_CNAE_CNPJ.pdf");
    addLog("Relatório PDF exportado com sucesso.");
  };

  // Geração opcional de planilha CSV (totalmente otimizada para milhares de registros com Blob)
  const handleExportCSV = () => {
    const successes = cnpjList.filter(item => item.status === "success");
    if (successes.length === 0) return;

    let csvContent = "\uFEFF"; // UTF-8 BOM para rodar no Excel brasileiro sem corromper acentos
    csvContent += "Razao Social,CNPJ,CNAE,Descricao CNAE\n";

    successes.forEach(item => {
      // Aspas duplas seguras para escapar vírgulas ou quebras nas descrições e nomes de clientes
      const name = `"${item.nomeCliente.replace(/"/g, '""')}"`;
      const cnpj = `"${item.cnpjFormatado}"`;
      const cnae = `"${item.cnae}"`;
      const desc = `"${item.descricaoCnae.replace(/"/g, '""')}"`;
      csvContent += `${name},${cnpj},${cnae},${desc}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "empresas_cnae_segmentos.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog(`Resumo: Backup de planilha CSV exportado com sucesso contendo ${successes.length} registros.`);
  };

  // Filtra e classifica itens
  const filteredCnpjList = cnpjList.filter(item => {
    const matchesSearch = 
      item.cnpj.includes(searchTerm) || 
      item.nomeCliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.cnae.includes(searchTerm) ||
      item.descricaoCnae.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  // Fatiamento inteligente para exibição sob demanda (zero lentidão no DOM com milhares de registros)
  const paginatedCnpjList = filteredCnpjList.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredCnpjList.length / itemsPerPage);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-16 selection:bg-indigo-500 selection:text-white">
      {/* Header Principal */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-600 rounded-lg text-white">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-tight">
                Validador, Segmento e Consulta de CNPJ
              </h1>
              <p className="text-xs text-slate-500 font-mono">
                Powered by Gemini 3.5-flash & Google Search
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5 border border-slate-200">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span>
              API Online
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        
        {/* Banner de Cookies Bloqueados no Iframe */}
        {cookieBlocked && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6 shadow-xs flex items-start gap-4 animate-fade-in">
            <div className="p-2 bg-amber-100 rounded-lg text-amber-800">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-amber-900">Restrição de Cookies de Segurança Ativa (Iframe)</h3>
              <p className="text-xs text-slate-700 mt-1 leading-relaxed font-sans">
                Seu navegador está bloqueando cookies de terceiros dentro deste iframe isolado do AI Studio (comum no Safari, Chrome Anônimo ou iOS).
                Para que as investigações de CNPJ via Gemini funcionem imediatamente, por favor autorize o acesso no iframe ou abra em uma nova aba dedicada.
              </p>
              <div className="flex items-center flex-wrap gap-3 mt-3.5">
                <button
                  onClick={handleRequestStorageAccess}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  Autorizar Acesso a Cookies no Iframe
                </button>
                <a 
                  href={window.location.href} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir App em Nova Aba Dedicada
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Bloco Superior: Arrastamento e Entrada Manual */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Coluna 1: Upload e Envio de PDF */}
          <div className="lg:col-span-7 bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-slate-850">Enviar Documento em PDF</h2>
              </div>
              <p className="text-sm text-slate-500 mb-5">
                Carregue relatórios, contratos ou declarações fiscais. Nossa inteligência artificial lerá todas as páginas buscando CNPJs estruturados automaticamente.
              </p>

              {/* Área de Drag and Drop */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 transition-all flex flex-col items-center justify-center cursor-pointer ${
                  dragActive 
                    ? "border-indigo-500 bg-indigo-50/50" 
                    : selectedFile 
                      ? "border-emerald-300 bg-emerald-50/10" 
                      : "border-slate-300 hover:border-slate-400 bg-slate-50 hover:bg-slate-100/50"
                }`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={triggerFileSelect}
                id="drop-zone"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="application/pdf"
                  onChange={handleFileChange}
                />
                
                {selectedFile ? (
                  <div className="text-center">
                    <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
                      <FileCheck className="w-6 h-6" />
                    </div>
                    <span className="block text-sm font-semibold text-slate-800 break-all">{selectedFile.name}</span>
                    <span className="block text-xs text-slate-500 mt-1">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB - Pronto para ler</span>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="mx-auto w-12 h-12 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center mb-3">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <span className="block text-sm font-medium text-slate-700">Arrastar arquivo PDF aqui</span>
                    <span className="block text-xs text-slate-400 mt-1">Ou clique para navegar</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
              {selectedFile ? (
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-xs text-rose-600 font-medium hover:underline p-1"
                >
                  Remover arquivo
                </button>
              ) : (
                <span className="text-xs text-slate-400 font-mono">Formatos suportados: apenas .PDF</span>
              )}

              <button
                disabled={!selectedFile || isUploading}
                onClick={handleScanPDF}
                className={`py-2 px-5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
                  !selectedFile || isUploading
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                    : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm font-semibold"
                }`}
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Lendo PDF...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Varrer PDF buscando CNPJ
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Coluna 2: Inserção Manual e Resumo */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            
            {/* Bloco Entrada Manual */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2 mb-3">
                <Plus className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-slate-850">Inserir CNPJ Manualmente</h2>
              </div>
              <p className="text-sm text-slate-500 mb-4">
                Caso prefira, digite ou cole um CNPJ direto (formato livre, apenas os números serão extraídos).
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="EX: 00.000.000/0001-91"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddManualCnpj();
                  }}
                  className="flex-1 px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <button
                  onClick={handleAddManualCnpj}
                  className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-800 border-indigo-100 border text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar
                </button>
              </div>
            </div>

            {/* Bloco Estatísticas Atuais */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex-1 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Dados Rápidos do Painel</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 border border-slate-150 p-3.5 rounded-lg text-center">
                    <span className="block text-xs text-slate-500 font-medium">Cadastrados para processar</span>
                    <span className="block text-2xl font-bold text-slate-900 mt-1">{cnpjList.length}</span>
                  </div>
                  <div className="bg-emerald-50/40 border border-emerald-100 p-3.5 rounded-lg text-center">
                    <span className="block text-xs text-emerald-600 font-medium">Buscados com Sucesso</span>
                    <span className="block text-2xl font-bold text-emerald-700 mt-1">
                      {cnpjList.filter(i => i.status === "success").length}
                    </span>
                  </div>
                </div>
              </div>

              {cnpjList.length > 0 && (
                <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col gap-2">
                  <button
                    onClick={startBatchProcessing}
                    disabled={isProcessingAll}
                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg text-sm flex items-center justify-center gap-2 transition-all shadow-xs"
                  >
                    {isProcessingAll ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Buscando informações na Internet...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 text-emerald-400" />
                        Iniciar Investigações CNAE/Setor
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Bloco Histórico de Anexos / Documentos Processados */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <FileCheck className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-slate-850">Histórico de Documentos</h2>
              </div>
              <p className="text-xs text-slate-500 mb-4 font-normal">
                Alterne fluidamente entre análises e anexos importados anteriormente.
              </p>

              {historyRecords.length === 0 ? (
                <div className="text-center p-6 border-2 border-dashed border-slate-100 rounded-lg text-slate-400 text-xs italic">
                  Nenhum arquivo no histórico ainda. Envie um PDF para preencher.
                </div>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {historyRecords.map((record, index) => {
                    const successCount = record.items.filter(i => i.status === "success").length;
                    const totalCount = record.items.length;
                    const isCurrent = currentFileName === record.fileName;

                    return (
                      <div
                        key={index}
                        onClick={() => handleLoadHistory(record)}
                        className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex items-center justify-between group/hist ${
                          isCurrent
                            ? "bg-indigo-50/55 border-indigo-300 text-indigo-900 font-semibold"
                            : "bg-slate-50/70 hover:bg-slate-100 border-slate-200 text-slate-700"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block font-semibold text-xs truncate" title={record.fileName}>
                            {record.fileName}
                          </span>
                          <span className="block text-[10px] text-slate-400 mt-0.5 font-sans">
                            Consultado em: {record.processedAt}
                          </span>
                          <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-indigo-600 font-sans">
                            {successCount} de {totalCount} validados
                          </span>
                        </div>
                        <button
                          onClick={(e) => handleDeleteHistoryRecord(record.fileName, e)}
                          className="p-1 px-1.5 ml-2 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600 transition-colors opacity-0 group-hover/hist:opacity-100 focus:opacity-100"
                          title="Excluir este histórico"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

        </div>

        {/* Console de Atividades e Logs */}
        <div className="bg-slate-900 text-slate-350 p-4 rounded-xl mt-8 border border-slate-800 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100 uppercase tracking-widest font-mono">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></div>
              Console de Eventos da IA
            </div>
            {logs.length > 0 && (
              <button 
                onClick={() => setLogs([])}
                className="text-[11px] text-slate-500 hover:text-slate-300 underline font-mono"
              >
                Limpar Logs
              </button>
            )}
          </div>
          <div className="font-mono text-[11px] space-y-1.5 max-h-[140px] overflow-y-auto custom-scrollbar leading-relaxed">
            {logs.length === 0 ? (
              <span className="text-slate-600 italic">Nenhuma atividade registrada no momento. Envie um PDF para começar as investigações.</span>
            ) : (
              logs.map((log, id) => (
                <div key={id} className="first:text-white">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Dashboard de Resultados da Investigação */}
        <div className="bg-white rounded-xl border border-slate-200 mt-8 shadow-sm overflow-hidden">
          
          {/* Header e Filtros da Tabela */}
          <div className="p-6 border-b border-slate-200 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Empresas e CNPJs Triados</h2>
              <p className="text-xs text-slate-500 mt-1">
                Visualização unificada de dados localizados e processados pela internet.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Barra de Busca rápida */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filtrar CNAE/Razão/CNPJ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>



              {cnpjList.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-rose-600 transition-colors"
                  title="Apagar todos da lista"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Área Principal da Tabela */}
          <div className="overflow-x-auto">
            {filteredCnpjList.length === 0 ? (
              <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
                <Building2 className="w-12 h-12 text-slate-300 mb-3" />
                <h4 className="font-semibold text-slate-700">Nenhum registro encontrado</h4>
                <p className="text-sm text-slate-400 mt-1 max-w-md">
                  A lista está vazia. Cadastre um CNPJ manualmente ou faça upload de um arquivo PDF para extrairmos os dados de forma automatizada.
                </p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200 text-left border-collapse">
                <thead className="bg-slate-50 font-mono text-xs text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3.5 font-semibold text-[11px]">Status / Investigação</th>
                    <th className="px-6 py-3.5 font-semibold text-[11px]">Razão Social / Cliente</th>
                    <th className="px-6 py-3.5 font-semibold text-[11px]">CNPJ</th>
                    <th className="px-6 py-3.5 font-semibold text-[11px]">CNAE Principal</th>
                    <th className="px-6 py-3.5 font-semibold text-[11px]">Atividade Econômica</th>
                    <th className="px-6 py-3.5 font-semibold text-[11px] text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200 text-xs">
                  {paginatedCnpjList.map((item, index) => {
                    // Localiza o índice real correto na lista original (para manipulação de status)
                    const originalIndex = cnpjList.findIndex(orig => orig.cnpj === item.cnpj);
                    const isEditing = editingCnpj === item.cnpj;

                    return (
                      <tr 
                        key={item.cnpj} 
                        className={`transition-colors text-slate-800 ${isEditing ? "bg-indigo-50/20 hover:bg-indigo-50/30" : "hover:bg-slate-50/60 group"}`}
                      >
                        {/* Status do Item */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          {isEditing ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-indigo-100 text-indigo-800 font-bold text-[10px] border border-indigo-300 shadow-3xs animate-pulse">
                              <CheckCircle2 className="w-3 h-3 text-indigo-600" />
                              Customizando
                            </span>
                          ) : (
                            <>
                              {item.status === "pending" && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 text-amber-700 font-medium text-[10px] border border-amber-200">
                                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                                  Fila de Trabalho
                                </span>
                              )}
                              {item.status === "searching" && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium text-[10px] border border-indigo-200">
                                  <RefreshCw className="w-3 h-3 animate-spin text-indigo-500" />
                                  Buscando na Web
                                </span>
                              )}
                              {item.status === "success" && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium text-[10px] border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  Validado
                                </span>
                              )}
                              {item.status === "failed" && (
                                <span 
                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-50 text-rose-700 font-medium text-[10px] border border-rose-200"
                                  title={item.error}
                                >
                                  <XCircle className="w-3.5 h-3.5 text-rose-500" />
                                  Falhou
                                </span>
                              )}
                            </>
                          )}
                        </td>

                        {/* Nome / Razão Social */}
                        <td className="px-6 py-4">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editForm.nomeCliente}
                              onChange={e => setEditForm(prev => ({ ...prev, nomeCliente: e.target.value }))}
                              className="w-full min-w-[150px] px-2.5 py-1.5 border border-indigo-300 rounded font-medium text-xs text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                            />
                          ) : (
                            <>
                              <div className="font-semibold text-slate-850 break-words max-w-[200px]">
                                {item.nomeCliente}
                              </div>
                              {item.origem && item.origem !== "unknown" && (
                                <span className="text-[9px] text-slate-400 block mt-0.5">
                                  Fonte: 
                                  {item.origem === "brasilapi" && " Receita Federal Básica"}
                                  {item.origem === "google_search" && " Econodata / IA Web Search"}
                                  {item.origem === "local_classification" && " Classificador de Backup"}
                                </span>
                              )}
                            </>
                          )}
                        </td>

                        {/* CNPJ */}
                        <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-700 font-medium bg-slate-50/40">
                          {item.cnpjFormatado}
                        </td>

                        {/* CNAE Principal */}
                        <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-600 font-medium">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editForm.cnae}
                              placeholder="Ex: 6201-5/01"
                              onChange={e => setEditForm(prev => ({ ...prev, cnae: e.target.value }))}
                              className="w-24 px-2 py-1.5 border border-indigo-300 rounded text-xs text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden font-mono"
                            />
                          ) : (
                            item.cnae === "Pendente" || item.cnae === "-" ? (
                              <span className="text-slate-400 italic">Não lido</span>
                            ) : (
                              item.cnae
                            )
                          )}
                        </td>

                        {/* Descrição CNAE */}
                        <td className="px-6 py-4 max-w-[320px] truncate text-slate-500 break-words" title={item.descricaoCnae}>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editForm.descricaoCnae}
                              placeholder="Ex: Desenvolvimento de software..."
                              onChange={e => setEditForm(prev => ({ ...prev, descricaoCnae: e.target.value }))}
                              className="w-full min-w-[200px] px-2.5 py-1.5 border border-indigo-300 rounded text-xs text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                            />
                          ) : (
                            item.descricaoCnae === "Pendente" || item.descricaoCnae === "-" ? (
                              <span className="text-slate-400 italic">Não lido</span>
                            ) : (
                              item.descricaoCnae
                            )
                          )}
                        </td>

                        {/* Ações por linha */}
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => handleSaveEdit(originalIndex)}
                                className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10.5px] font-semibold transition-all shadow-xs cursor-pointer"
                              >
                                Salvar
                              </button>
                              <button
                                onClick={() => setEditingCnpj(null)}
                                className="px-2.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10.5px] font-semibold border border-slate-300 transition-all cursor-pointer"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => handleStartEdit(item)}
                                className="px-2.5 py-1.5 rounded-md border border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50 text-slate-600 hover:text-indigo-700 text-[10px] font-semibold transition-all cursor-pointer"
                                title="Editar manualmente este registro"
                              >
                                Editar
                              </button>

                              {/* Buscar dados especificamente deste item */}
                              {(item.status === "pending" || item.status === "failed") && (
                                <button
                                  onClick={() => lookupSingleCNPJ(originalIndex)}
                                  className="px-2.5 py-1.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-semibold transition-all border border-indigo-100 cursor-pointer"
                                  title="Pesquisar este CNPJ agora"
                                >
                                  Consultar
                                </button>
                              )}

                              {/* Remover elemento individual */}
                              <button
                                onClick={() => handleRemoveItem(originalIndex)}
                                className="p-1.5 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-650 transition-colors cursor-pointer"
                                title="Remover da lista de trabalho"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Paginação de Alta Performance */}
          {totalPages > 1 && (
            <div className="bg-slate-50/50 px-6 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-[11px] text-slate-500 font-mono">
                Mostrando <span className="font-bold text-slate-700">{(currentPage - 1) * itemsPerPage + 1}</span> a{" "}
                <span className="font-bold text-slate-700">
                  {Math.min(currentPage * itemsPerPage, filteredCnpjList.length)}
                </span>{" "}
                de <span className="font-bold text-indigo-700">{filteredCnpjList.length}</span> registros (Página {currentPage} de {totalPages})
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-800 text-[11px] font-semibold transition-all shadow-3xs disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                >
                  Anterior
                </button>
                <div className="flex items-center space-x-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = i + 1;
                    if (currentPage > 3) {
                      pageNum = currentPage - 3 + i;
                    }
                    if (pageNum + (4 - i) > totalPages) {
                      pageNum = Math.max(1, totalPages - 4 + i);
                    }
                    
                    if (pageNum <= 0 || pageNum > totalPages) return null;

                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 rounded-md text-[11px] font-bold transition-all flex items-center justify-center cursor-pointer ${
                          currentPage === pageNum
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "border border-slate-200 bg-white text-slate-600 hover:text-slate-800 hover:bg-slate-50 shadow-3xs"
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-650 hover:text-slate-800 text-[11px] font-semibold transition-all shadow-3xs disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                >
                  Próximo
                </button>
              </div>
            </div>
          )}

          {/* Bar Superior de Exportação */}
          {cnpjList.some(item => item.status === "success") && (
            <div className="bg-slate-55 p-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-slate-500 font-medium">
                Pronto: <span className="text-slate-850 font-bold">{cnpjList.filter(i => i.status === "success").length}</span> CNPJ(s) pesquisados com sucesso e elegíveis para relatório oficial.
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={handleExportCSV}
                  className="flex-1 sm:flex-none border border-slate-300 hover:border-slate-400 bg-white text-slate-700 hover:text-slate-900 font-medium py-2 px-4 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-2xs"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Salvar CSV Excel
                </button>

                <button
                  onClick={handleExportPDF}
                  className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-5 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
                >
                  <FileDown className="w-3.5 h-3.5 text-indigo-200" />
                  Exportar Relatório em PDF
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Informações explicativas */}
        <section className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-5 rounded-xl border border-slate-150 shadow-3xs">
            <h4 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              1. Varredura via IA
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              O modelo multimodal do Gemini 3.5 lê o documento PDF completo, transcrevendo e localizando todos os CNPJs mesmo que estejam divididos em tabelas ou que se trate de imagem/digitalização de baixa qualidade.
            </p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-150 shadow-3xs">
            <h4 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-500" />
              2. Consulta Híbrida Inteligente
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              O motor de busca primeiro valida os dados do CNPJ em APIs de registro público do governo e, em caso de instabilidade, consulta o Google e Econodata com IA para buscar e garantir a descrição correta e o segmento.
            </p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-150 shadow-3xs">
            <h4 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5">
              <FileDown className="w-4 h-4 text-violet-500" />
              3. Relatório em PDF
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Ao final do processamento, você gera em um clique o relatório PDF formatado com todas as investigações: Nome do Cliente, CNPJ, segmento conforme CNAE e respectiva descrição técnica.
            </p>
          </div>
        </section>

      </main>
    </div>
  );
}
