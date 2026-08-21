/**
 * FeedbackProgress.tsx
 * ──────────────────────────────────────────────────────────────
 * Componente de Feedback Visual para Operações Longas
 * Exibe mensagens de aguardo, progresso e estimativa de tempo
 */

import React, { useState, useEffect } from 'react';
import { Loader2, Clock, AlertCircle, CheckCircle, Brain } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

export interface FeedbackProgressProps {
  isVisible: boolean;
  titulo?: string;
  mensagem?: string;
  subtitulo?: string;
  etapa?: string;
  progresso?: number; // 0-100
  tempoEstimado?: number; // em segundos
  tempoDecorrido?: number; // em segundos
  status?: "processando" | "predizendo" | "gerando" | "corrigindo" | "finalizado" | "erro";
  erro?: string;
  onCancel?: () => void;
}

export function FeedbackProgress({
  isVisible,
  titulo = "Processando...",
  mensagem = "Aguarde enquanto o sistema processa sua solicitação.",
  subtitulo = "Isso pode levar alguns segundos.",
  etapa = "Inicializando...",
  progresso = 0,
  tempoEstimado = 0,
  tempoDecorrido = 0,
  status = "processando",
  erro,
  onCancel
}: FeedbackProgressProps) {
  const [tempoFormatado, setTempoFormatado] = useState("0s");
  const [estimativaFormatada, setEstimativaFormatada] = useState("calculando...");

  // Formatar tempo
  useEffect(() => {
    if (tempoDecorrido > 0) {
      if (tempoDecorrido < 60) {
        setTempoFormatado(`${Math.floor(tempoDecorrido)}s`);
      } else {
        const minutos = Math.floor(tempoDecorrido / 60);
        const segundos = Math.floor(tempoDecorrido % 60);
        setTempoFormatado(`${minutos}m ${segundos}s`);
      }
    } else {
      setTempoFormatado("0s");
    }

    if (tempoEstimado > 0) {
      if (tempoEstimado < 60) {
        setEstimativaFormatada(`~${Math.ceil(tempoEstimado)}s`);
      } else {
        const minutos = Math.floor(tempoEstimado / 60);
        const segundos = Math.ceil(tempoEstimado % 60);
        setEstimativaFormatada(`~${minutos}m ${segundos}s`);
      }
    } else {
      setEstimativaFormatada("calculando...");
    }
  }, [tempoDecorrido, tempoEstimado]);

  // Ícone baseado no status
  const getIcon = () => {
    switch (status) {
      case "predizendo":
        return <Brain className="w-8 h-8 text-purple-500 animate-pulse" />;
      case "gerando":
        return <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />;
      case "corrigindo":
        return <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />;
      case "finalizado":
        return <CheckCircle className="w-8 h-8 text-green-500" />;
      case "erro":
        return <AlertCircle className="w-8 h-8 text-red-500" />;
      default:
        return <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />;
    }
  };

  // Cor do progresso
  const getProgressColor = () => {
    switch (status) {
      case "erro":
        return "bg-red-500";
      case "finalizado":
        return "bg-green-500";
      case "predizendo":
        return "bg-purple-500";
      case "corrigindo":
        return "bg-orange-500";
      default:
        return "bg-blue-500";
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print">
      <Card className="w-full max-w-lg shadow-2xl border-2 dark:border-zinc-800">
        <CardContent className="pt-6">
          {/* Cabeçalho */}
          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0 mt-1">
              {getIcon()}
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {titulo}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-350">
                {mensagem}
              </p>
              {subtitulo && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {subtitulo}
                </p>
              )}
            </div>
          </div>

          {/* Etapa Atual */}
          <div className="mb-3">
            <div className="flex justify-between items-center text-sm">
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {etapa}
              </span>
              <span className="text-gray-500 dark:text-gray-400 font-semibold">
                {progresso > 0 ? `${Math.round(progresso)}%` : "..."}
              </span>
            </div>
          </div>

          {/* Barra de Progresso */}
          <div className="mb-4">
            <Progress 
              value={progresso} 
              className={`h-2`}
            />
          </div>

          {/* Tempo */}
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 font-mono">
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>Tempo: {tempoFormatado}</span>
            </div>
            <div>
              <span>Estimativa: {estimativaFormatada}</span>
            </div>
          </div>

          {/* Mensagem de Erro */}
          {erro && status === "erro" && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">
                    Erro durante o processamento
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-450">
                    {erro}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Botão Cancelar */}
          {onCancel && status !== "finalizado" && status !== "erro" && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 
                         hover:bg-gray-100 rounded-lg transition-colors
                         dark:text-gray-400 dark:hover:text-gray-200 
                         dark:hover:bg-gray-800 font-semibold"
              >
                Cancelar
              </button>
            </div>
          )}

          {/* Status Finalizado */}
          {status === "finalizado" && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg 
                         transition-colors"
              >
                Concluído
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// HOOK PARA GERENCIAR O PROGRESSO
// ──────────────────────────────────────────────────────────────

export function useFeedbackProgress() {
  const [isVisible, setIsVisible] = useState(false);
  const [titulo, setTitulo] = useState("Processando...");
  const [mensagem, setMensagem] = useState("Aguarde enquanto o sistema processa sua solicitação.");
  const [subtitulo, setSubtitulo] = useState("Isso pode levar alguns segundos.");
  const [etapa, setEtapa] = useState("Inicializando...");
  const [progresso, setProgresso] = useState(0);
  const [tempoEstimado, setTempoEstimado] = useState(0);
  const [tempoDecorrido, setTempoDecorrido] = useState(0);
  const [status, setStatus] = useState<"processando" | "predizendo" | "gerando" | "corrigindo" | "finalizado" | "erro">("processando");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [timerVal, setTimerVal] = useState<number | null>(null);

  // Use state instead of ref/interval to keep track safely
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isVisible && status !== "finalizado" && status !== "erro") {
      interval = setInterval(() => {
        setTempoDecorrido(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isVisible, status]);

  // Iniciar progresso
  const start = (config?: Partial<FeedbackProgressProps>) => {
    setIsVisible(true);
    setStatus("processando");
    setProgresso(0);
    setTempoDecorrido(0);
    setErro(undefined);
    
    if (config?.titulo) setTitulo(config.titulo);
    if (config?.mensagem) setMensagem(config.mensagem);
    if (config?.subtitulo) setSubtitulo(config.subtitulo);
    if (config?.etapa) setEtapa(config.etapa);
    if (config?.tempoEstimado) setTempoEstimado(config.tempoEstimado);
  };

  // Atualizar progresso
  const update = (config: Partial<FeedbackProgressProps>) => {
    if (config.progresso !== undefined) setProgresso(config.progresso);
    if (config.etapa) setEtapa(config.etapa);
    if (config.mensagem) setMensagem(config.mensagem);
    if (config.subtitulo) setSubtitulo(config.subtitulo);
    if (config.status) setStatus(config.status);
    if (config.erro) setErro(config.erro);
    if (config.titulo) setTitulo(config.titulo);
  };

  // Finalizar com sucesso
  const success = (mensagemSucesso?: string) => {
    setStatus("finalizado");
    setProgresso(100);
    if (mensagemSucesso) setMensagem(mensagemSucesso);
    setEtapa("✅ Concluído!");
  };

  // Finalizar com erro
  const fail = (mensagemErro: string, detalhe?: string) => {
    setStatus("erro");
    setErro(detalhe ? `${mensagemErro}: ${detalhe}` : mensagemErro);
    setEtapa("❌ Erro");
  };

  // Fechar
  const close = () => {
    setIsVisible(false);
  };

  return {
    isVisible,
    titulo,
    mensagem,
    subtitulo,
    etapa,
    progresso,
    tempoEstimado,
    tempoDecorrido,
    status,
    erro,
    start,
    update,
    success,
    fail,
    close,
    FeedbackProgress: () => (
      <FeedbackProgress
        isVisible={isVisible}
        titulo={titulo}
        mensagem={mensagem}
        subtitulo={subtitulo}
        etapa={etapa}
        progresso={progresso}
        tempoEstimado={tempoEstimado}
        tempoDecorrido={tempoDecorrido}
        status={status}
        erro={erro}
        onCancel={close}
      />
    )
  };
}
