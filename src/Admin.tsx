import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Gift,
  ImagePlus,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { appPath } from "./lib/routes";
import { fruitKits } from "./lib/fruitKits";
import MarketplaceAdmin from "./MarketplaceAdmin";
import "./admin.css";

type AdminRaffle = {
  id: string;
  title: string;
  description: string;
  rules: string;
  prize: string;
  photo_url: string | null;
  draw_at: string;
  starts_at: string;
  ends_at: string;
  max_participants: number | null;
  status: "active" | "paused" | "finished";
  is_active: boolean;
  created_at: string;
};

type Registration = {
  id: string;
  raffle_id: string;
  full_name: string;
  cpf: string;
  phone: string;
  created_at: string;
};

type DrawResult = {
  id: string;
  raffle_id: string;
  winner_name: string;
  prize: string;
  drawn_at: string;
  is_published: boolean;
};

type AdminTab = "overview" | "marketplace" | "raffles" | "participants" | "results";
type RaffleFilter = "active" | "paused" | "finished";

type RaffleForm = {
  title: string;
  description: string;
  rules: string;
  prize: string;
  starts_at: string;
  ends_at: string;
  draw_at: string;
  is_active: boolean;
  photo_url: string;
  has_limit: boolean;
  max_participants: string;
};

const pageSize = 25;

function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function getRaffleStatus(raffle: AdminRaffle): RaffleFilter {
  if (raffle.status === "finished" || new Date(raffle.ends_at).getTime() <= Date.now()) {
    return "finished";
  }
  return raffle.is_active ? "active" : "paused";
}

function raffleStatusLabel(status: RaffleFilter) {
  if (status === "active") return "Ativo";
  if (status === "finished") return "Finalizado";
  return "Pausado";
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function maskCpf(value: string) {
  return `${value.slice(0, 3)}.***.***-${value.slice(-2)}`;
}

function csvCell(value: string) {
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function csvRows(rows: Registration[]) {
  const header = ["Nome", "CPF", "Celular", "Inscrito em"];
  return [
    header.map(csvCell).join(";"),
    ...rows.map((row) =>
      [
        row.full_name,
        row.cpf,
        row.phone,
        displayDate(row.created_at),
      ].map(csvCell).join(";"),
    ),
  ].join("\r\n");
}

function emptyRaffleForm(): RaffleForm {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 5 * 60_000);
  const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const drawAt = new Date(now.getTime() + 8 * 24 * 60 * 60_000);
  return {
    title: "",
    description: "",
    rules: "",
    prize: "",
    starts_at: localDateTime(startsAt.toISOString()),
    ends_at: localDateTime(endsAt.toISOString()),
    draw_at: localDateTime(drawAt.toISOString()),
    is_active: false,
    photo_url: "",
    has_limit: false,
    max_participants: "",
  };
}

function AdminBrand() {
  return (
    <a className="brand" href={appPath()} aria-label="Voltar para Kit Feira">
      <img className="brand-logo" src="/kit-feira-logo.png" alt="Kit Feira — Na sua porta" />
    </a>
  );
}

function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [raffles, setRaffles] = useState<AdminRaffle[]>([]);
  const [raffleFilter, setRaffleFilter] = useState<RaffleFilter>("active");
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [drawResults, setDrawResults] = useState<DrawResult[]>([]);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [loadingData, setLoadingData] = useState(false);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedRaffleId, setSelectedRaffleId] = useState("");
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [registrationPage, setRegistrationPage] = useState(0);
  const [registrationTotal, setRegistrationTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [raffleForm, setRaffleForm] = useState<RaffleForm>(emptyRaffleForm);
  const [editingRaffleId, setEditingRaffleId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [selectedKitPreset, setSelectedKitPreset] = useState("");
  const [savingRaffle, setSavingRaffle] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [deletingRaffleId, setDeletingRaffleId] = useState<string | null>(null);

  const selectedRaffle = useMemo(
    () => raffles.find((raffle) => raffle.id === selectedRaffleId) ?? null,
    [raffles, selectedRaffleId],
  );
  const selectedResult = useMemo(
    () => drawResults.find((result) => result.raffle_id === selectedRaffleId) ?? null,
    [drawResults, selectedRaffleId],
  );
  const filteredRaffles = useMemo(
    () => raffles.filter((raffle) => getRaffleStatus(raffle) === raffleFilter),
    [raffles, raffleFilter],
  );
  const raffleFilterCounts = useMemo(
    () =>
      raffles.reduce<Record<RaffleFilter, number>>(
        (counts, raffle) => {
          counts[getRaffleStatus(raffle)] += 1;
          return counts;
        },
        { active: 0, paused: 0, finished: 0 },
      ),
    [raffles],
  );
  const pageCount = Math.max(1, Math.ceil(registrationTotal / pageSize));

  useEffect(() => {
    if (!supabase) {
      setCheckingAccess(false);
      return;
    }
    const client = supabase;

    let active = true;
    const verifySession = async (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setIsAdmin(false);
        setCheckingAccess(false);
        return;
      }

      setCheckingAccess(true);
      const { data, error } = await client.rpc("is_feira_admin");
      if (!active) return;
      setIsAdmin(!error && data === true);
      setAuthError(
        error ? `Não foi possível verificar o acesso: ${error.message}` : "",
      );
      setCheckingAccess(false);
    };

    void client.auth.getSession().then(({ data, error }) => {
      if (error) setAuthError(`Não foi possível validar a sessão: ${error.message}`);
      void verifySession(data.session);
    });

    const { data: authListener } = client.auth.onAuthStateChange(
      (_event, nextSession) => {
        window.setTimeout(() => void verifySession(nextSession), 0);
      },
    );
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || checkingAccess || isAdmin || !supabase) return;

    void supabase.auth.signOut().then(({ error }) => {
      if (error) setAuthError(`Não foi possível encerrar a sessão: ${error.message}`);
      window.location.replace(appPath());
    });
  }, [checkingAccess, isAdmin, session]);

  async function loadAdminData() {
    if (!supabase) return;
    setLoadingData(true);
    setPageError("");
    const now = new Date().toISOString();
    const { error: expirationError } = await supabase
      .from("raffles")
      .update({ is_active: false, status: "finished" })
      .neq("status", "finished")
      .lte("ends_at", now);
    if (expirationError) {
      setPageError(
        expirationError.code === "PGRST204" || expirationError.code === "PGRST202"
          ? "O banco ainda não tem a atualização de status dos sorteios. Execute o arquivo supabase/schema.sql no SQL Editor."
          : `Não foi possível atualizar sorteios encerrados: ${expirationError.message}`,
      );
      setLoadingData(false);
      return;
    }

    const [raffleResponse, resultResponse, countResponse] = await Promise.all([
      supabase
        .from("raffles")
        .select("id, title, description, rules, prize, photo_url, draw_at, starts_at, ends_at, max_participants, status, is_active, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("draw_results")
        .select("id, raffle_id, winner_name, prize, drawn_at, is_published")
        .order("drawn_at", { ascending: false }),
      supabase.rpc("admin_registration_counts"),
    ]);

    const errorMessage =
      raffleResponse.error?.message ??
      resultResponse.error?.message ??
      countResponse.error?.message;
    if (errorMessage) {
      setPageError(
        raffleResponse.error?.code === "PGRST204" ||
          countResponse.error?.code === "PGRST202"
          ? "O banco ainda não tem todas as tabelas e funções do painel. Execute o arquivo supabase/schema.sql no SQL Editor."
          : `Não foi possível carregar o painel: ${errorMessage}`,
      );
    } else {
      const nextRaffles = (raffleResponse.data ?? []) as AdminRaffle[];
      const nextResults = (resultResponse.data ?? []) as DrawResult[];
      const nextRegistrationCounts = (
        (countResponse.data ?? []) as { raffle_id: string; registration_count: number }[]
      ).reduce<Record<string, number>>((counts, row) => {
        counts[row.raffle_id] = Number(row.registration_count);
        return counts;
      }, {});
      setRaffles(nextRaffles);
      setDrawResults(nextResults);
      setRegistrationCounts(nextRegistrationCounts);
      setRegistrationCount(Object.values(nextRegistrationCounts).reduce((total, count) => total + count, 0));
      setSelectedRaffleId((current) =>
        nextRaffles.some((raffle) => raffle.id === current)
          ? current
          : nextRaffles.find((raffle) => raffle.is_active)?.id ?? nextRaffles[0]?.id ?? "",
      );
    }
    setLoadingData(false);
  }

  useEffect(() => {
    if (session && isAdmin) void loadAdminData();
  }, [session, isAdmin]);

  useEffect(() => {
    const client = supabase;
    if (
      !client ||
      !session ||
      !isAdmin ||
      activeTab !== "participants" ||
      !selectedRaffleId
    ) {
      setRegistrations([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setRegistrationsLoading(true);
      setRegistrationError("");
      let query = client
        .from("registrations")
        .select("id, raffle_id, full_name, cpf, phone, created_at", { count: "exact" })
        .eq("raffle_id", selectedRaffleId)
        .order("created_at", { ascending: false })
        .range(registrationPage * pageSize, (registrationPage + 1) * pageSize - 1);
      const term = registrationSearch.trim();
      if (term) {
        const digits = term.replace(/\D/g, "");
        if (digits.length === term.length) {
          query = query.ilike("cpf", `%${digits}%`);
        } else {
          const safeTerm = term.replace(/[,%()\\]/g, "");
          if (safeTerm) query = query.ilike("full_name", `%${safeTerm}%`);
        }
      }

      const { data, error, count } = await query;
      if (!active) return;
      if (error) {
        setRegistrationError(`Não foi possível carregar as inscrições: ${error.message}`);
      } else {
        setRegistrations((data ?? []) as Registration[]);
        setRegistrationTotal(count ?? 0);
      }
      setRegistrationsLoading(false);
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeTab, isAdmin, registrationPage, registrationSearch, selectedRaffleId, session]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSigningIn(true);
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSigningIn(false);
    if (error) setAuthError(`Não foi possível entrar: ${error.message}`);
  }

  async function handleSignOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setAuthError(`Não foi possível sair: ${error.message}`);
  }

  function startNewRaffle() {
    setEditingRaffleId(null);
    setRaffleForm(emptyRaffleForm());
    setSelectedImage(null);
    setSelectedKitPreset("");
    setNotice("");
    setActiveTab("raffles");
  }

  function editRaffle(raffle: AdminRaffle) {
    setEditingRaffleId(raffle.id);
    setRaffleForm({
      title: raffle.title,
      description: raffle.description ?? "",
      rules: raffle.rules ?? "",
      prize: raffle.prize,
      starts_at: localDateTime(raffle.starts_at),
      ends_at: localDateTime(raffle.ends_at),
      draw_at: localDateTime(raffle.draw_at),
      is_active: raffle.is_active,
      photo_url: raffle.photo_url ?? "",
      has_limit: raffle.max_participants !== null,
      max_participants: raffle.max_participants?.toString() ?? "",
    });
    setSelectedImage(null);
    setSelectedKitPreset("");
    setNotice("");
    setActiveTab("raffles");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyKitPreset() {
    const kit = fruitKits.find((item) => item.id === selectedKitPreset);
    if (!kit) return;
    setRaffleForm((current) => ({
      ...current,
      title: kit.raffleTitle,
      prize: kit.prize,
      description: `${kit.description} ${kit.fruits.join(" ")}`,
      rules:
        current.rules ||
        "A composição do kit pode variar conforme a estação e a disponibilidade das frutas na feira.",
    }));
    setNotice("Modelo de kit aplicado. Ajuste os detalhes e adicione uma foto para publicar.");
  }

  async function handleSaveRaffle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setNotice("");
    if (
      new Date(raffleForm.starts_at) >= new Date(raffleForm.ends_at) ||
      new Date(raffleForm.draw_at) < new Date(raffleForm.ends_at)
    ) {
      setNotice("O encerramento deve ser após a abertura e o sorteio deve ocorrer após o encerramento.");
      return;
    }
    const maxParticipants = raffleForm.has_limit
      ? Number(raffleForm.max_participants)
      : null;
    if (
      raffleForm.has_limit &&
      (!Number.isInteger(maxParticipants) || maxParticipants === null || maxParticipants < 1)
    ) {
      setNotice("Informe um limite de participantes igual ou maior que 1, ou desative a opção de limite.");
      return;
    }
    if (
      editingRaffleId &&
      maxParticipants !== null &&
      maxParticipants < (registrationCounts[editingRaffleId] ?? 0)
    ) {
      setNotice("O limite não pode ser menor que as inscrições que este sorteio já recebeu.");
      return;
    }
    if (
      selectedImage &&
      !["image/jpeg", "image/png", "image/webp"].includes(selectedImage.type)
    ) {
      setNotice("A imagem deve estar no formato JPG, PNG ou WEBP.");
      return;
    }
    if (selectedImage && selectedImage.size > 5 * 1024 * 1024) {
      setNotice("A imagem deve ter no máximo 5 MB.");
      return;
    }

    setSavingRaffle(true);
    let photoUrl = raffleForm.photo_url;
    if (selectedImage) {
      const extension = selectedImage.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("raffle-images")
        .upload(path, selectedImage, { upsert: false, contentType: selectedImage.type });
      if (uploadError) {
        setNotice(`Não foi possível enviar a imagem: ${uploadError.message}`);
        setSavingRaffle(false);
        return;
      }
      photoUrl = supabase.storage.from("raffle-images").getPublicUrl(path).data.publicUrl;
    }

    const values = {
      title: raffleForm.title.trim(),
      description: raffleForm.description.trim(),
      rules: raffleForm.rules.trim(),
      prize: raffleForm.prize.trim(),
      starts_at: new Date(raffleForm.starts_at).toISOString(),
      ends_at: new Date(raffleForm.ends_at).toISOString(),
      draw_at: new Date(raffleForm.draw_at).toISOString(),
      is_active: raffleForm.is_active,
      photo_url: photoUrl || null,
      max_participants: maxParticipants,
      status: raffleForm.is_active
        ? "active"
        : editingRaffleId && raffles.some((raffle) => raffle.id === editingRaffleId && getRaffleStatus(raffle) === "finished")
          ? "finished"
          : "paused",
    };
    const response = editingRaffleId
      ? await supabase.from("raffles").update(values).eq("id", editingRaffleId)
      : await supabase.from("raffles").insert(values);
    setSavingRaffle(false);
    if (response.error) {
      setNotice(
        response.error.code === "23505"
          ? "Já existe outro sorteio ativo. Encerre-o antes de ativar este."
          : `Não foi possível salvar o sorteio: ${response.error.message}`,
      );
      return;
    }

    setNotice(editingRaffleId ? "Sorteio atualizado." : "Sorteio criado.");
    setEditingRaffleId(null);
    setSelectedImage(null);
    setRaffleForm(emptyRaffleForm());
    await loadAdminData();
  }

  async function finishRaffle(raffle: AdminRaffle) {
    if (!supabase) return;
    if (!window.confirm(`Finalizar o sorteio "${raffle.title}"? Novas inscrições serão encerradas.`)) {
      return;
    }

    setNotice("");
    const { error } = await supabase
      .from("raffles")
      .update({ is_active: false, status: "finished" })
      .eq("id", raffle.id);
    if (error) {
      setNotice(`Não foi possível finalizar o sorteio: ${error.message}`);
      return;
    }
    setNotice(`Sorteio "${raffle.title}" finalizado.`);
    await loadAdminData();
  }

  async function deleteRaffle(raffle: AdminRaffle) {
    if (!supabase) return;
    const registrationTotal = registrationCounts[raffle.id] ?? 0;
    const hasResult = drawResults.some((result) => result.raffle_id === raffle.id);
    const relatedData = [
      ...(registrationTotal > 0
        ? [`${registrationTotal} ${registrationTotal === 1 ? "inscrição" : "inscrições"}`]
        : []),
      ...(hasResult ? ["o resultado do sorteio"] : []),
    ];
    if (
      !window.confirm(
        `Excluir "${raffle.title}" permanentemente?${relatedData.length ? ` Também serão apagados ${relatedData.join(" e ")}.` : ""} Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }

    setDeletingRaffleId(raffle.id);
    setNotice("");
    const { data, error } = await supabase
      .from("raffles")
      .delete()
      .eq("id", raffle.id)
      .select("id")
      .maybeSingle();
    if (error) {
      setNotice(`Não foi possível excluir o sorteio: ${error.message}`);
      setDeletingRaffleId(null);
      return;
    }
    if (!data) {
      setNotice("Este sorteio não foi encontrado ou já foi excluído.");
      setDeletingRaffleId(null);
      await loadAdminData();
      return;
    }

    const imagePath = raffle.photo_url?.split("/storage/v1/object/public/raffle-images/")[1];
    let imageCleanupNotice = "";
    if (imagePath) {
      const { error: imageError } = await supabase.storage
        .from("raffle-images")
        .remove([imagePath]);
      if (imageError) {
        imageCleanupNotice = ` Não foi possível remover a foto: ${imageError.message}`;
      }
    }

    if (editingRaffleId === raffle.id) {
      setEditingRaffleId(null);
      setRaffleForm(emptyRaffleForm());
      setSelectedImage(null);
    }
    setNotice(`Sorteio "${raffle.title}" excluído.${imageCleanupNotice}`);
    setDeletingRaffleId(null);
    await loadAdminData();
  }

  async function exportRegistrations() {
    if (!supabase || !selectedRaffleId) return;
    setExporting(true);
    setRegistrationError("");
    const allRows: Registration[] = [];
    const term = registrationSearch.trim();
    let offset = 0;
    while (true) {
      let query = supabase
        .from("registrations")
        .select("id, raffle_id, full_name, cpf, phone, created_at")
        .eq("raffle_id", selectedRaffleId)
        .order("created_at", { ascending: false })
        .range(offset, offset + 999);
      if (term) {
        const digits = term.replace(/\D/g, "");
        if (digits.length === term.length) query = query.ilike("cpf", `%${digits}%`);
        else {
          const safeTerm = term.replace(/[,%()\\]/g, "");
          if (safeTerm) query = query.ilike("full_name", `%${safeTerm}%`);
        }
      }
      const { data, error } = await query;
      if (error) {
        setRegistrationError(`Não foi possível exportar: ${error.message}`);
        setExporting(false);
        return;
      }
      const chunk = (data ?? []) as Registration[];
      allRows.push(...chunk);
      if (chunk.length < 1000) break;
      offset += 1000;
    }

    const blob = new Blob(["\uFEFF", csvRows(allRows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inscricoes-${selectedRaffle?.title ?? "kit-feira"}.csv`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9.-]/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  }

  async function handleDraw() {
    if (!supabase || !selectedRaffleId) return;
    if (!selectedRaffle) return;
    const participantCount = registrationCounts[selectedRaffleId] ?? 0;
    if (participantCount === 0) {
      setNotice("Não há participantes inscritos para realizar este sorteio.");
      return;
    }
    if (
      !window.confirm(
        `Realizar o sorteio de "${selectedRaffle.title}" agora? As inscrições serão encerradas e não será possível incluir novos participantes.`,
      )
    ) {
      return;
    }

    setDrawing(true);
    setNotice("");
    const { error } = await supabase.rpc("perform_draw", {
      p_raffle_id: selectedRaffleId,
    });
    setDrawing(false);
    if (error) {
      setNotice(`Não foi possível realizar o sorteio: ${error.message}`);
      return;
    }
    setNotice("Sorteio realizado. Confira o resultado antes de publicá-lo.");
    await loadAdminData();
  }

  async function publishResult(result: DrawResult) {
    if (!supabase) return;
    setNotice("");
    const { error } = await supabase
      .from("draw_results")
      .update({ is_published: !result.is_published })
      .eq("id", result.id);
    if (error) {
      setNotice(`Não foi possível atualizar a publicação: ${error.message}`);
      return;
    }
    setNotice(result.is_published ? "Resultado despublicado." : "Resultado publicado no site.");
    await loadAdminData();
  }

  function updateForm<K extends keyof RaffleForm>(key: K, value: RaffleForm[K]) {
    setRaffleForm((current) => ({ ...current, [key]: value }));
  }

  if (!isSupabaseConfigured || !supabase) {
    return (
      <div className="admin-login-page">
        <div className="admin-login-card">
          <AdminBrand />
          <h1>Configure o banco de dados</h1>
          <p>Adicione as credenciais do Supabase ao arquivo de ambiente para abrir o painel.</p>
          <a className="admin-back-link" href={appPath()}>Voltar ao site</a>
        </div>
      </div>
    );
  }

  if (checkingAccess) {
    return <div className="admin-loading"><LoaderCircle className="spin" size={23} /> Verificando acesso...</div>;
  }

  if (!session) {
    return (
      <div className="admin-login-page">
        <a className="admin-login-back" href={appPath()}><ArrowLeft size={16} /> Voltar ao site</a>
        <div className="admin-login-card">
          <AdminBrand />
          <span className="admin-kicker">ÁREA RESTRITA</span>
          <h1>Que bom ter você<br /><span>por aqui.</span></h1>
          <p>Entre para cuidar dos produtos, pedidos, custos e campanhas do Kit Feira.</p>
          <form onSubmit={handleSignIn} className="admin-login-form">
            <label>
              E-mail
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="seu@email.com"
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Sua senha"
                required
              />
            </label>
            {authError && <p className="admin-error"><CircleAlert size={16} /> {authError}</p>}
            <button className="button button-dark admin-login-button" type="submit" disabled={signingIn}>
              {signingIn ? <><LoaderCircle className="spin" size={17} /> Entrando...</> : <>Entrar no painel <ArrowRight size={17} /></>}
            </button>
          </form>
          <div className="admin-login-secure"><ShieldCheck size={15} /> Acesso seguro via Supabase Auth</div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="admin-loading"><LoaderCircle className="spin" size={23} /> Acesso não autorizado. Voltando ao início...</div>
    );
  }

  const tabs: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "overview", label: "Visão geral", icon: LayoutDashboard },
    { id: "marketplace", label: "Loja Kit Feira", icon: ShoppingBag },
    { id: "raffles", label: "Sorteios", icon: Gift },
    { id: "participants", label: "Inscrições", icon: Users },
    { id: "results", label: "Resultados", icon: Trophy },
  ];

  return (
    <div className="admin-shell">
      <aside className={mobileNavOpen ? "admin-sidebar sidebar-open" : "admin-sidebar"}>
        <div className="admin-sidebar-brand"><AdminBrand /><button type="button" className="sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Fechar menu"><X size={20} /></button></div>
        <div className="sidebar-label">ADMINISTRAÇÃO</div>
        <nav className="admin-nav" aria-label="Navegação do painel">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              className={activeTab === id ? "admin-nav-item active" : "admin-nav-item"}
              type="button"
              key={id}
              onClick={() => { setActiveTab(id); setMobileNavOpen(false); setNotice(""); }}
            >
              <Icon size={18} /> {label}
              {id === "raffles" && <span className="nav-count">{raffles.length}</span>}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <a href={appPath()} className="sidebar-public-link"><ArrowLeft size={16} /> Ver site público</a>
          <div className="admin-user">
            <span className="admin-avatar">{session.user.email?.[0]?.toUpperCase() ?? "A"}</span>
            <span className="admin-user-email">{session.user.email}</span>
            <button type="button" onClick={() => void handleSignOut()} aria-label="Sair" title="Sair">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="admin-mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button>
          <div className="admin-breadcrumb">Kit Feira <span>/</span> Administração</div>
          <div className="admin-topbar-right"><span className="admin-online-dot" /> Painel ativo</div>
        </header>

        <main className="admin-content">
          {pageError && <div className="admin-alert error"><CircleAlert size={17} /> {pageError}</div>}
          {notice && <div className="admin-alert success"><Check size={17} /> {notice}<button type="button" onClick={() => setNotice("")} aria-label="Fechar"><X size={15} /></button></div>}
          {loadingData && (
            <div className="admin-loading-inline"><LoaderCircle className="spin" size={18} /> Atualizando dados...</div>
          )}

          {activeTab === "overview" && (
            <section>
              <div className="admin-page-heading">
                <div><span className="admin-kicker">SEU ESPAÇO DE CONTROLE</span><h1>Olá, vamos <span>cuidar da loja?</span></h1><p>Acompanhe kits, pedidos, custos de compra e sorteios em um só lugar.</p></div>
                <div className="admin-overview-actions">
                  <button className="admin-secondary-button" type="button" onClick={() => setActiveTab("marketplace")}><ShoppingBag size={15} /> Abrir loja</button>
                  <button className="button button-dark" type="button" onClick={startNewRaffle}><Plus size={17} /> Criar sorteio</button>
                </div>
              </div>
              <MarketplaceAdmin compact onOpenStore={() => setActiveTab("marketplace")} />
              <div className="admin-stat-grid">
                <article className="admin-stat-card"><span className="stat-icon"><Gift size={18} /></span><small>SORTEIOS CADASTRADOS</small><strong>{raffles.length}</strong><span>no total</span></article>
                <article className="admin-stat-card"><span className="stat-icon"><Users size={18} /></span><small>INSCRIÇÕES RECEBIDAS</small><strong>{registrationCount}</strong><span>em todos os sorteios</span></article>
                <article className="admin-stat-card"><span className="stat-icon"><Trophy size={18} /></span><small>RESULTADOS PUBLICADOS</small><strong>{drawResults.filter((result) => result.is_published).length}</strong><span>visíveis no site</span></article>
              </div>
              <div className="admin-content-heading"><div><h2>Sorteios recentes</h2><p>Edite as informações ou confira o andamento.</p></div><button className="admin-link-button" onClick={() => setActiveTab("raffles")}>Ver todos <ArrowRight size={15} /></button></div>
              {raffles.length ? (
                <div className="raffle-admin-list">
                  {raffles.slice(0, 4).map((raffle) => (
                    <article className="raffle-admin-row" key={raffle.id}>
                      {raffle.photo_url ? <img src={raffle.photo_url} alt="" /> : <span className="raffle-placeholder"><Gift size={20} /></span>}
                  <div className="raffle-admin-info"><h3>{raffle.title}</h3><span>{raffle.prize} · {registrationCounts[raffle.id] ?? 0}{raffle.max_participants === null ? " inscritos · sem limite" : ` de ${raffle.max_participants} inscritos`} · Encerramento {displayDate(raffle.ends_at)}</span></div>
                      <span className={getRaffleStatus(raffle) === "active" ? "raffle-state open" : "raffle-state"}><i />{raffleStatusLabel(getRaffleStatus(raffle))}</span>
                      <button className="icon-button" type="button" onClick={() => editRaffle(raffle)} aria-label={`Editar ${raffle.title}`}><Pencil size={16} /></button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="admin-empty"><span><Gift size={22} /></span><h3>Seu primeiro sorteio começa aqui.</h3><p>Adicione o prêmio, as regras e uma foto para apresentar sua campanha.</p><button className="button button-lime" onClick={startNewRaffle}><Plus size={17} /> Criar primeiro sorteio</button></div>
              )}
            </section>
          )}

          {activeTab === "raffles" && (
            <section>
              <div className="admin-page-heading">
                <div><span className="admin-kicker">CAMPANHAS E PRÊMIOS</span><h1>{editingRaffleId ? "Editar sorteio" : "Seus sorteios"}</h1><p>Defina a apresentação, as regras e as datas de cada campanha.</p></div>
                {!editingRaffleId && <button className="button button-dark" onClick={startNewRaffle}><Plus size={17} /> Novo sorteio</button>}
              </div>
              <form className="raffle-editor" onSubmit={handleSaveRaffle}>
                <div className="editor-title"><div><span className="editor-step">01</span><div><h2>{editingRaffleId ? "Informações do sorteio" : "Criar um sorteio"}</h2><p>Campos com * são obrigatórios.</p></div></div><label className="active-toggle"><input type="checkbox" checked={raffleForm.is_active} onChange={(event) => updateForm("is_active", event.target.checked)} /><span></span><b>{raffleForm.is_active ? "Ativo" : "Pausado"}</b></label></div>
                <div className="kit-preset-picker">
                  <div><strong>Vai sortear um kit de frutas?</strong><span>Comece com um modelo Kit Feira e personalize as informações.</span></div>
                  <select value={selectedKitPreset} onChange={(event) => setSelectedKitPreset(event.target.value)} aria-label="Modelo de kit de frutas">
                    <option value="">Escolher um kit</option>
                    {fruitKits.map((kit) => <option value={kit.id} key={kit.id}>{kit.name}</option>)}
                  </select>
                  <button type="button" className="admin-secondary-button" onClick={applyKitPreset} disabled={!selectedKitPreset}>Usar modelo</button>
                </div>
                <div className="capacity-setting">
                  <label className="capacity-toggle">
                    <input
                      type="checkbox"
                      checked={raffleForm.has_limit}
                      onChange={(event) => updateForm("has_limit", event.target.checked)}
                    />
                    <span className="capacity-toggle-track" />
                    <span><strong>Definir limite de participantes</strong><small>Desative para aceitar inscrições sem limite de quantidade.</small></span>
                  </label>
                  {raffleForm.has_limit && (
                    <label className="capacity-input">
                      Limite de participantes
                      <input
                        type="number"
                        min={Math.max(1, editingRaffleId ? registrationCounts[editingRaffleId] ?? 1 : 1)}
                        step="1"
                        value={raffleForm.max_participants}
                        onChange={(event) => updateForm("max_participants", event.target.value)}
                        placeholder="Ex.: 100"
                        required
                      />
                    </label>
                  )}
                  {editingRaffleId && (
                    <span className="capacity-current-count">
                      <Users size={15} /> {registrationCounts[editingRaffleId] ?? 0} inscrito(s) até agora
                    </span>
                  )}
                </div>
                <div className="editor-grid">
                  <label className="editor-field">Nome do sorteio *<input value={raffleForm.title} onChange={(event) => updateForm("title", event.target.value)} maxLength={120} placeholder="Ex.: Festival de prêmios" required /></label>
                  <label className="editor-field">Prêmio em destaque *<input value={raffleForm.prize} onChange={(event) => updateForm("prize", event.target.value)} maxLength={180} placeholder="Ex.: Uma bicicleta nova" required /></label>
                  <label className="editor-field editor-full">Descrição<textarea value={raffleForm.description} onChange={(event) => updateForm("description", event.target.value)} rows={3} maxLength={2000} placeholder="Conte aos participantes sobre este sorteio." /></label>
                  <label className="editor-field editor-full">Regras e condições<textarea value={raffleForm.rules} onChange={(event) => updateForm("rules", event.target.value)} rows={4} maxLength={5000} placeholder="Descreva as regras, elegibilidade e condições de participação." /></label>
                  <div className="editor-field editor-full">
                    <span className="editor-label">Foto do prêmio ou da campanha</span>
                    <label className="image-upload">
                      <input type="file" accept="image/*" onChange={(event) => setSelectedImage(event.target.files?.[0] ?? null)} />
                      {selectedImage ? <><ImagePlus size={18} /><span>{selectedImage.name}</span><small>Trocar imagem</small></> : raffleForm.photo_url ? <><img src={raffleForm.photo_url} alt="Prévia do sorteio" /><span>Foto atual</span><small>Trocar imagem</small></> : <><ImagePlus size={20} /><span>Escolha uma imagem do seu dispositivo</span><small>JPG, PNG ou WEBP · até 5 MB</small></>}
                    </label>
                  </div>
                  <label className="editor-field"><span className="date-label"><CalendarDays size={15} /> Início das inscrições *</span><input type="datetime-local" value={raffleForm.starts_at} onChange={(event) => updateForm("starts_at", event.target.value)} required /></label>
                  <label className="editor-field"><span className="date-label"><CalendarDays size={15} /> Encerramento *</span><input type="datetime-local" value={raffleForm.ends_at} onChange={(event) => updateForm("ends_at", event.target.value)} required /></label>
                  <label className="editor-field"><span className="date-label"><Trophy size={15} /> Data do sorteio *</span><input type="datetime-local" value={raffleForm.draw_at} onChange={(event) => updateForm("draw_at", event.target.value)} required /></label>
                </div>
                <div className="editor-actions">
                  {editingRaffleId && <button className="admin-secondary-button" type="button" onClick={() => { setEditingRaffleId(null); setRaffleForm(emptyRaffleForm()); setSelectedImage(null); setNotice(""); }}>Cancelar edição</button>}
                  <button className="button button-dark" type="submit" disabled={savingRaffle}>{savingRaffle ? <><LoaderCircle className="spin" size={17} /> Salvando...</> : <>{editingRaffleId ? "Salvar alterações" : "Salvar sorteio"} <ArrowRight size={16} /></>}</button>
                </div>
              </form>
              <div className="admin-content-heading raffle-list-heading"><div><h2>Sorteios cadastrados</h2><p>Os dados exibidos vêm dos sorteios salvos no Supabase.</p></div></div>
              <div className="raffle-filter-tabs" role="tablist" aria-label="Filtrar sorteios por status">
                {([
                  ["active", "Ativos"],
                  ["paused", "Pausados"],
                  ["finished", "Finalizados"],
                ] as const).map(([status, label]) => (
                  <button
                    className={raffleFilter === status ? "raffle-filter-tab selected" : "raffle-filter-tab"}
                    type="button"
                    role="tab"
                    aria-selected={raffleFilter === status}
                    key={status}
                    onClick={() => setRaffleFilter(status)}
                  >
                    {label}<span>{raffleFilterCounts[status]}</span>
                  </button>
                ))}
              </div>
              {filteredRaffles.length ? <div className="raffle-admin-list">{filteredRaffles.map((raffle) => (
                <article className="raffle-admin-row" key={raffle.id}>
                  {raffle.photo_url ? <img src={raffle.photo_url} alt="" /> : <span className="raffle-placeholder"><Gift size={20} /></span>}
                  <div className="raffle-admin-info"><h3>{raffle.title}</h3><span>{raffle.prize} · {registrationCounts[raffle.id] ?? 0}{raffle.max_participants === null ? " inscritos · sem limite" : ` de ${raffle.max_participants} inscritos`} · Sorteio {displayDate(raffle.draw_at)}</span></div>
                  <span className={getRaffleStatus(raffle) === "active" ? "raffle-state open" : "raffle-state"}><i />{raffleStatusLabel(getRaffleStatus(raffle))}</span>
                  <div className="raffle-row-actions">
                    {getRaffleStatus(raffle) !== "finished" && <button className="finish-raffle-button" type="button" onClick={() => void finishRaffle(raffle)}>Finalizar</button>}
                    <button className="icon-button" type="button" onClick={() => editRaffle(raffle)} aria-label={`Editar ${raffle.title}`}><Pencil size={16} /></button>
                    <button
                      className="icon-button icon-button-danger"
                      type="button"
                      onClick={() => void deleteRaffle(raffle)}
                      disabled={deletingRaffleId === raffle.id}
                      aria-label={`Excluir ${raffle.title}`}
                      title="Excluir sorteio"
                    >
                      {deletingRaffleId === raffle.id
                        ? <LoaderCircle className="spin" size={16} />
                        : <Trash2 size={16} />}
                    </button>
                  </div>
                </article>
              ))}</div> : <div className="admin-empty raffle-filter-empty"><span>{raffleFilter === "active" ? <Gift size={22} /> : raffleFilter === "finished" ? <Trophy size={22} /> : <CalendarDays size={22} />}</span><h3>{raffleFilter === "active" ? "Nenhum sorteio ativo." : raffleFilter === "finished" ? "Nenhum sorteio finalizado." : "Nenhum sorteio pausado."}</h3><p>{raffleFilter === "active" ? "Ative um sorteio existente ou crie uma nova campanha para exibi-la no site." : "Quando houver sorteios nesta categoria, eles aparecerão aqui."}</p>{raffleFilter === "active" && <button className="button button-lime" onClick={startNewRaffle}><Plus size={17} /> Criar sorteio</button>}</div>}
            </section>
          )}

          {activeTab === "participants" && (
            <section>
              <div className="admin-page-heading">
                <div><span className="admin-kicker">PARTICIPANTES</span><h1>Inscrições</h1><p>Consulte os participantes do sorteio selecionado.</p></div>
              </div>
              <div className="participants-toolbar">
                <label className="raffle-select-label">Sorteio
                  <select value={selectedRaffleId} onChange={(event) => { setSelectedRaffleId(event.target.value); setRegistrationPage(0); }}>
                    <option value="">Selecione um sorteio</option>
                    {raffles.map((raffle) => <option value={raffle.id} key={raffle.id}>{raffle.title}</option>)}
                  </select>
                </label>
                <label className="participant-search"><Search size={17} /><input value={registrationSearch} onChange={(event) => { setRegistrationSearch(event.target.value); setRegistrationPage(0); }} placeholder="Buscar por nome ou CPF" /></label>
                <button className="admin-secondary-button export-button" type="button" onClick={() => void exportRegistrations()} disabled={!selectedRaffleId || exporting}>
                  {exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Exportar CSV
                </button>
              </div>
              {selectedRaffle && (
                <div className="participant-capacity-note">
                  <Users size={16} />
                  <span>
                    <strong>{registrationCounts[selectedRaffle.id] ?? 0}</strong> pessoa(s) inscrita(s)
                    {selectedRaffle.max_participants === null
                      ? " · sem limite de participantes"
                      : ` · limite de ${selectedRaffle.max_participants} participantes`}
                  </span>
                </div>
              )}
              <div className="participant-table-wrap">
                {registrationError && <div className="admin-alert error"><CircleAlert size={17} /> {registrationError}</div>}
                <table className="participant-table">
                  <thead><tr><th>Participante</th><th>CPF</th><th>Celular</th><th>Inscrito em</th></tr></thead>
                  <tbody>
                    {registrationsLoading ? <tr><td colSpan={4} className="table-state"><LoaderCircle className="spin" size={18} /> Carregando inscrições...</td></tr> : registrations.length ? registrations.map((registration) => (
                      <tr key={registration.id}><td><strong>{registration.full_name}</strong></td><td>{maskCpf(registration.cpf)}</td><td>{registration.phone}</td><td>{displayDate(registration.created_at)}</td></tr>
                    )) : <tr><td colSpan={4} className="table-state">{selectedRaffleId ? "Nenhuma inscrição encontrada." : "Selecione um sorteio para consultar os participantes."}</td></tr>}
                  </tbody>
                </table>
                <div className="table-footer"><span>{registrationTotal} inscrição(ões)</span><div><button type="button" aria-label="Página anterior" disabled={registrationPage === 0} onClick={() => setRegistrationPage((page) => page - 1)}><ChevronLeft size={17} /></button><span>{registrationPage + 1} / {pageCount}</span><button type="button" aria-label="Próxima página" disabled={registrationPage + 1 >= pageCount} onClick={() => setRegistrationPage((page) => page + 1)}><ChevronRight size={17} /></button></div></div>
              </div>
              <p className="privacy-hint"><ShieldCheck size={15} /> O CPF completo fica oculto nesta tela. O arquivo CSV contém os dados completos e deve ser armazenado com segurança.</p>
            </section>
          )}

          {activeTab === "results" && (
            <section>
              <div className="admin-page-heading">
                <div><span className="admin-kicker">SORTEIO E DIVULGAÇÃO</span><h1>Resultados</h1><p>Realize o sorteio no horário definido e publique o resultado no site.</p></div>
              </div>
              <div className="result-manager">
                <label className="raffle-select-label">Sorteio
                  <select value={selectedRaffleId} onChange={(event) => setSelectedRaffleId(event.target.value)}>
                    <option value="">Selecione um sorteio</option>
                    {raffles.map((raffle) => <option value={raffle.id} key={raffle.id}>{raffle.title}</option>)}
                  </select>
                </label>
                {selectedRaffle ? (
                  <div className="draw-card">
                    <div className="draw-card-top"><span className="draw-icon"><Trophy size={21} /></span><div><span className="admin-kicker">PRÊMIO</span><h2>{selectedRaffle.prize}</h2></div><span className={selectedRaffle.is_active ? "raffle-state open" : "raffle-state"}><i />{selectedRaffle.is_active ? "Ativo" : "Pausado"}</span></div>
                    <div className="draw-meta"><span><CalendarDays size={15} /> Data do sorteio</span><strong>{displayDate(selectedRaffle.draw_at)}</strong></div>
                    {selectedResult ? (
                      <div className="draw-winner">
                        <span className="winner-check"><Check size={19} /></span>
                        <div><small>PARTICIPANTE SORTEADO</small><strong>{selectedResult.winner_name}</strong><span>Resultado gerado em {displayDate(selectedResult.drawn_at)}</span></div>
                        <button className={selectedResult.is_published ? "publish-button published" : "publish-button"} onClick={() => void publishResult(selectedResult)} type="button">{selectedResult.is_published ? "Publicado no site" : "Publicar resultado"} <ArrowRight size={15} /></button>
                      </div>
                    ) : (
                      <div className="draw-action">
                        <p>Você pode sortear antes da data prevista. Ao realizar, as inscrições serão encerradas e o resultado ficará oculto até você publicá-lo.</p>
                        <button className="button button-dark" type="button" onClick={() => void handleDraw()} disabled={drawing || (registrationCounts[selectedRaffle.id] ?? 0) === 0}>
                          {drawing ? <><LoaderCircle className="spin" size={17} /> Sorteando...</> : <>Sortear participante <Trophy size={17} /></>}
                        </button>
                        {(registrationCounts[selectedRaffle.id] ?? 0) === 0 && <small>É preciso ter ao menos um participante inscrito.</small>}
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="admin-empty"><span><Trophy size={22} /></span><h3>Selecione um sorteio</h3><p>Escolha uma campanha para conferir ou realizar o sorteio.</p></div>
                )}
              </div>
              <div className="admin-content-heading"><div><h2>Histórico de resultados</h2><p>Os resultados publicados ficam visíveis no site público.</p></div><a className="admin-link-button" href={`${appPath()}#resultado`}>Ver no site <ArrowRight size={15} /></a></div>
              {drawResults.length ? <div className="result-history">{drawResults.map((result) => {
                const raffle = raffles.find((item) => item.id === result.raffle_id);
                return <article className="result-history-row" key={result.id}><span className="history-trophy"><Trophy size={18} /></span><div><strong>{result.winner_name}</strong><span>{raffle?.title ?? "Sorteio"} · {result.prize}</span></div><span className={result.is_published ? "raffle-state open" : "raffle-state"}><i />{result.is_published ? "Publicado" : "Rascunho"}</span><button className={result.is_published ? "admin-secondary-button" : "admin-publish-small"} type="button" onClick={() => void publishResult(result)}>{result.is_published ? "Ocultar" : "Publicar"}</button></article>;
              })}</div> : <p className="admin-list-empty">Nenhum resultado foi gerado ainda.</p>}
            </section>
          )}

          {activeTab === "marketplace" && <MarketplaceAdmin />}
        </main>
      </div>
      <a className="admin-public-floating" href={appPath()}><ArrowLeft size={15} /> Site público</a>
    </div>
  );
}

export default AdminApp;
