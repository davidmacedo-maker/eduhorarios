import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTurmas, generateId, storageKey } from "@/store";
import { turmasDbService } from "@/lib/database/turmas.service";
import type { Turma, Turno } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const turmaSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  turno: z.enum(["manha", "tarde", "noite"]),
  serie: z.string().min(1, "Série é obrigatória"),
  anoLetivo: z.coerce.number().min(2020).max(2035),
  observacoes: z.string().optional(),
  estrategiaDistribuicao: z.enum(["distribuir", "concentrar", "auto"]).default("distribuir"),
});

type TurmaForm = z.infer<typeof turmaSchema>;

const turnoLabels: Record<Turno, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };
const turnoVariants: Record<Turno, string> = {
  manha: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  tarde: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  noite: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
};

export default function Turmas() {
  const [turmas, setTurmas] = useTurmas();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTurma, setEditingTurma] = useState<Turma | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Turma | null>(null);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  // Carregar dados oficiais do Supabase ao montar a página
  useEffect(() => {
    async function carregarTurmasSupabase() {
      try {
        const dados = await turmasDbService.listar();
        if (dados && dados.length > 0) {
          setTurmas(dados);
        }
      } catch (err) {
        console.warn("Aviso ao carregar turmas do Supabase:", err);
      }
    }
    carregarTurmasSupabase();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let editId = params.get("edit");
    const sessionEditId = sessionStorage.getItem("edit_turma_id");
    if (sessionEditId) {
      editId = sessionEditId;
    }
    if (editId && turmas.length > 0 && !modalOpen) {
      const found = turmas.find((t) => t.id === editId);
      if (found) {
        sessionStorage.removeItem("edit_turma_id");
        openEdit(found);
      }
    }
  }, [turmas, modalOpen]);

  const form = useForm<TurmaForm>({
    resolver: zodResolver(turmaSchema),
    defaultValues: {
      nome: "",
      turno: "manha",
      serie: "",
      anoLetivo: new Date().getFullYear(),
      observacoes: "",
      estrategiaDistribuicao: "distribuir",
    },
  });

  const watchedNome = form.watch("nome");
  useEffect(() => {
    if (!editingTurma && watchedNome) {
      const lower = watchedNome.toLowerCase();
      if (lower.includes("contra") || lower.includes("contraturno")) {
        form.setValue("estrategiaDistribuicao", "concentrar");
      } else {
        form.setValue("estrategiaDistribuicao", "distribuir");
      }
    }
  }, [watchedNome, editingTurma, form]);

  function openCreate() {
    const lastTurno = (localStorage.getItem(storageKey("edu_last_turno")) as Turno) || "manha";
    const lastSerie = localStorage.getItem(storageKey("edu_last_serie")) || "";
    form.reset({ nome: "", turno: lastTurno, serie: lastSerie, anoLetivo: new Date().getFullYear(), observacoes: "", estrategiaDistribuicao: "distribuir" });
    setEditingTurma(null);
    setModalOpen(true);
  }

  function openEdit(turma: Turma) {
    form.reset({
      nome: turma.nome,
      turno: turma.turno,
      serie: turma.serie,
      anoLetivo: turma.anoLetivo,
      observacoes: turma.observacoes || "",
      estrategiaDistribuicao: turma.estrategiaDistribuicao || "distribuir",
    });
    setEditingTurma(turma);
    setModalOpen(true);
  }

  async function onSubmit(data: TurmaForm) {
    localStorage.setItem(storageKey("edu_last_turno"), data.turno);
    localStorage.setItem(storageKey("edu_last_serie"), data.serie);

    try {
      if (editingTurma) {
        const updatedTurma: Turma = { ...editingTurma, ...data };
        await turmasDbService.salvar(updatedTurma);
        setTurmas((prev) => prev.map((t) => (t.id === editingTurma.id ? updatedTurma : t)));
        toast({ title: "Turma atualizada com sucesso" });
      } else {
        const newTurma: Turma = { id: generateId(), ...data, observacoes: data.observacoes || "" };
        await turmasDbService.salvar(newTurma);
        setTurmas((prev) => [...prev, newTurma]);
        toast({ title: "Turma criada com sucesso" });
      }
    } catch (err) {
      console.error("Erro ao salvar turma no banco:", err);
      toast({ title: "Erro ao salvar no banco", description: "Verifique a conexão com o Supabase", variant: "destructive" });
    }
    setModalOpen(false);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await turmasDbService.excluir(deleteTarget.id);
      setTurmas((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      toast({ title: "Turma excluída", variant: "destructive" });
    } catch (err) {
      console.error("Erro ao excluir turma do banco:", err);
      toast({ title: "Erro ao excluir turma", variant: "destructive" });
    }
    setDeleteTarget(null);
  }

  const filtered = turmas.filter(
    (t) =>
      t.nome.toLowerCase().includes(search.toLowerCase()) ||
      t.serie.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Turmas</h1>
          <p className="text-muted-foreground mt-1">Gerencie as turmas da escola</p>
        </div>
        <Button onClick={openCreate} data-testid="button-nova-turma">
          <Plus className="w-4 h-4 mr-2" />
          Nova Turma
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4">
            <CardTitle className="text-base">Todas as Turmas ({turmas.length})</CardTitle>
            <Input
              placeholder="Buscar turma..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs ml-auto"
              data-testid="input-search-turma"
              type="search"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Nenhuma turma encontrada</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Turno</TableHead>
                    <TableHead>Série</TableHead>
                    <TableHead>Ano Letivo</TableHead>
                    <TableHead>Estratégia</TableHead>
                    <TableHead>Observações</TableHead>
                    <TableHead className="w-24">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((turma) => (
                    <TableRow key={turma.id} data-testid={`row-turma-${turma.id}`}>
                      <TableCell className="font-medium">{turma.nome}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${turnoVariants[turma.turno]}`}>
                          {turnoLabels[turma.turno]}
                        </span>
                      </TableCell>
                      <TableCell>{turma.serie}</TableCell>
                      <TableCell>{turma.anoLetivo}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {turma.estrategiaDistribuicao === "concentrar"
                            ? "Concentrar"
                            : turma.estrategiaDistribuicao === "auto"
                            ? "Automático"
                            : "Distribuir"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                        {turma.observacoes || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(turma)}
                            data-testid={`button-edit-turma-${turma.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(turma)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-turma-${turma.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTurma ? "Editar Turma" : "Nova Turma"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome da Turma</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 6º Ano A" {...field} data-testid="input-turma-nome" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="turno"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Turno</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-turma-turno">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="manha">Manhã</SelectItem>
                          <SelectItem value="tarde">Tarde</SelectItem>
                          <SelectItem value="noite">Noite</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="anoLetivo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ano Letivo</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-turma-ano" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="serie"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Série</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 6º Ano" {...field} data-testid="input-turma-serie" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="estrategiaDistribuicao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estratégia de Distribuição</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-turma-estrategia">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="distribuir">Distribuir durante a semana</SelectItem>
                        <SelectItem value="concentrar">Concentrar no menor número de dias</SelectItem>
                        <SelectItem value="auto">Balanceamento automático</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="observacoes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observações</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Observações opcionais..." rows={2} {...field} data-testid="input-turma-obs" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" data-testid="button-submit-turma">
                  {editingTurma ? "Salvar" : "Criar Turma"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Turma</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a turma <strong>{deleteTarget?.nome}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
