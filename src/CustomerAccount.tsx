import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Home,
  LoaderCircle,
  LogOut,
  MapPin,
  PackageCheck,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserRound,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { lookupCep } from "./lib/cep";
import { appPath } from "./lib/routes";
import "./customer-account.css";

type CustomerProfile = {
  user_id: string;
  email: string;
  full_name: string;
  phone: string;
};

type CustomerAddress = {
  id: string;
  label: string;
  delivery_address: string;
  address_number: string;
  neighborhood: string;
  complement: string;
  postal_code: string;
  city: string;
  is_default: boolean;
  created_at: string;
};

type CustomerOrderItem = {
  order_id: string;
  kit_name: string;
  quantity: number;
  unit_label: string;
  line_total: number;
};

type CustomerOrder = {
  id: string;
  status: "pending" | "confirmed" | "preparing" | "delivered" | "cancelled";
  total: number;
  payment_method: string;
  created_at: string;
  delivery_address: string;
  address_number: string;
  neighborhood: string;
  complement: string;
  postal_code: string;
  city: string;
  items: CustomerOrderItem[];
};

type AddressDraft = {
  label: string;
  deliveryAddress: string;
  addressNumber: string;
  neighborhood: string;
  complement: string;
  postalCode: string;
  city: string;
};

const emptyAddress: AddressDraft = {
  label: "",
  deliveryAddress: "",
  addressNumber: "",
  neighborhood: "",
  complement: "",
  postalCode: "",
  city: "",
};

const orderStatusLabels: Record<CustomerOrder["status"], string> = {
  pending: "Aguardando confirmação",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhone(value: string) {
  const phone = digits(value).slice(0, 11);
  if (phone.length < 3) return phone;
  if (phone.length < 8) return `(${phone.slice(0, 2)}) ${phone.slice(2)}`;
  const split = phone.length === 11 ? 7 : 6;
  return `(${phone.slice(0, 2)}) ${phone.slice(2, split)}-${phone.slice(split)}`;
}

function formatPostalCode(value: string) {
  const postalCode = digits(value).slice(0, 8);
  return postalCode.length > 5
    ? `${postalCode.slice(0, 5)}-${postalCode.slice(5)}`
    : postalCode;
}

function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function authMessage(message: string) {
  if (/over_email_send_rate_limit|email.*rate limit|rate limit.*email/i.test(message)) {
    return "O limite de envio de e-mails do Supabase foi atingido. Aguarde antes de tentar novamente. Se você já tentou criar a conta, experimente entrar; para evitar esse limite em produção, configure um SMTP próprio no Supabase.";
  }
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar.";
  if (/user already registered/i.test(message)) return "Este e-mail já possui uma conta. Faça login.";
  if (/password should be at least/i.test(message)) return "A senha precisa ter pelo menos 8 caracteres.";
  return message;
}

export default function CustomerAccount({ accountRoute }: { accountRoute: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [authName, setAuthName] = useState("");
  const [authPhone, setAuthPhone] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirmation, setAuthPasswordConfirmation] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [accountTab, setAccountTab] = useState<"orders" | "addresses" | "profile">("orders");
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [notice, setNotice] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(emptyAddress);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [cepFeedback, setCepFeedback] = useState<{ type: "loading" | "success" | "error"; message: string } | null>(null);
  const cepLookupRequest = useRef(0);

  useEffect(() => {
    if (!supabase) {
      setCheckingSession(false);
      return;
    }

    let active = true;
    const applySession = (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      setCheckingSession(false);
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error && active) setAuthError(`Não foi possível validar a sessão: ${error.message}`);
      applySession(data.session);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => applySession(nextSession), 0);
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!checkingSession && session && !accountRoute) {
      window.location.replace(appPath("conta"));
    }
  }, [accountRoute, checkingSession, session]);

  async function loadAccount(userId: string, isActive: () => boolean = () => true) {
    if (!supabase) return;
    setAccountLoading(true);
    setAccountError("");

    const [profileResult, addressResult, orderResult] = await Promise.all([
      supabase
        .from("customer_profiles")
        .select("user_id, email, full_name, phone")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("customer_addresses")
        .select("id, label, delivery_address, address_number, neighborhood, complement, postal_code, city, is_default, created_at")
        .eq("user_id", userId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("marketplace_orders")
        .select("id, status, total, payment_method, created_at, delivery_address, address_number, neighborhood, complement, postal_code, city")
        .eq("customer_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (!isActive()) return;
    const queryError = profileResult.error ?? addressResult.error ?? orderResult.error;
    if (queryError) {
      setAccountError(
        ["PGRST202", "PGRST204", "PGRST205"].includes(queryError.code ?? "")
          ? "A conta ainda não está configurada no banco. A atualização de clientes precisa ser aplicada no Supabase."
          : `Não foi possível carregar sua conta: ${queryError.message}`,
      );
      setAccountLoading(false);
      return;
    }

    const nextProfile = profileResult.data as CustomerProfile | null;
    const nextAddresses = (addressResult.data ?? []) as CustomerAddress[];
    const nextOrders = (orderResult.data ?? []) as Omit<CustomerOrder, "items">[];
    let orderItems: CustomerOrderItem[] = [];
    if (nextOrders.length) {
      const { data, error } = await supabase
        .from("marketplace_order_items")
        .select("order_id, kit_name, quantity, unit_label, line_total")
        .in("order_id", nextOrders.map((order) => order.id));
      if (!isActive()) return;
      if (error) {
        setAccountError(`Não foi possível carregar os itens dos pedidos: ${error.message}`);
        setAccountLoading(false);
        return;
      }
      orderItems = (data ?? []) as CustomerOrderItem[];
    }

    const itemsByOrder = new Map<string, CustomerOrderItem[]>();
    for (const item of orderItems) {
      itemsByOrder.set(item.order_id, [
        ...(itemsByOrder.get(item.order_id) ?? []),
        item,
      ]);
    }

    setProfile(nextProfile);
    setProfileName(
      nextProfile?.full_name ||
        String(session?.user.user_metadata.full_name ?? ""),
    );
    setProfilePhone(formatPhone(nextProfile?.phone ?? String(session?.user.user_metadata.phone ?? "")));
    setAddresses(nextAddresses);
    setOrders(nextOrders.map((order) => ({
      ...order,
      items: itemsByOrder.get(order.id) ?? [],
    })));
    setAccountLoading(false);
  }

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setAddresses([]);
      setOrders([]);
      return;
    }
    let active = true;
    void loadAccount(session.user.id, () => active);
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (mode === "signup" && authPassword !== authPasswordConfirmation) {
      setAuthError("As senhas não conferem.");
      return;
    }
    setAuthSubmitting(true);
    setAuthError("");
    setAuthNotice("");

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim().toLowerCase(),
        password: authPassword,
        options: {
          data: {
            full_name: authName.trim(),
            phone: digits(authPhone),
          },
          emailRedirectTo: new URL(appPath("conta"), window.location.origin).toString(),
        },
      });
      setAuthSubmitting(false);
      if (error) {
        setAuthError(authMessage(error.message));
        return;
      }
      if (!data.session) {
        setAuthNotice("Conta criada! Confira seu e-mail para confirmar o cadastro e depois entre.");
        setMode("login");
        setAuthPassword("");
        setAuthPasswordConfirmation("");
        return;
      }
      setAuthNotice("Conta criada com sucesso. Estamos abrindo sua área do cliente.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim().toLowerCase(),
      password: authPassword,
    });
    setAuthSubmitting(false);
    if (error) setAuthError(authMessage(error.message));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session) return;
    setProfileSaving(true);
    setAccountError("");
    setNotice("");
    const { data, error } = await supabase
      .from("customer_profiles")
      .update({
      full_name: profileName.trim(),
      phone: digits(profilePhone),
      updated_at: new Date().toISOString(),
      })
      .eq("user_id", session.user.id)
      .select("user_id")
      .maybeSingle();
    setProfileSaving(false);
    if (error) {
      setAccountError(`Não foi possível salvar seus dados: ${error.message}`);
      return;
    }
    if (!data) {
      setAccountError("Não encontramos o cadastro da sua conta no banco. Atualize a migração de clientes no Supabase.");
      return;
    }
    setNotice("Seus dados foram atualizados.");
    setProfile((current) => current
      ? { ...current, full_name: profileName.trim(), phone: digits(profilePhone) }
      : current);
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setAddressSaving(true);
    setAccountError("");
    setNotice("");
    const { error } = await supabase.rpc("save_customer_address", {
      p_label: addressDraft.label.trim(),
      p_delivery_address: addressDraft.deliveryAddress.trim(),
      p_address_number: addressDraft.addressNumber.trim(),
      p_neighborhood: addressDraft.neighborhood.trim(),
      p_complement: addressDraft.complement.trim(),
      p_postal_code: digits(addressDraft.postalCode),
      p_city: addressDraft.city.trim(),
      p_is_default: false,
    });
    setAddressSaving(false);
    if (error) {
      setAccountError(`Não foi possível salvar o endereço: ${error.message}`);
      return;
    }
    setAddressDraft(emptyAddress);
    setAddressFormOpen(false);
    setNotice("Endereço salvo na sua conta.");
    if (session) await loadAccount(session.user.id);
  }

  async function lookupAddressFromCep() {
    const cep = digits(addressDraft.postalCode);
    if (cep.length !== 8) return;

    const requestId = ++cepLookupRequest.current;
    setCepFeedback({ type: "loading", message: "Buscando endereço pelo CEP..." });
    try {
      const address = await lookupCep(cep);
      if (requestId !== cepLookupRequest.current) return;
      if (!address) {
        setCepFeedback({ type: "error", message: "CEP não encontrado. Confira o número ou preencha o endereço manualmente." });
        return;
      }

      setAddressDraft((current) => ({
        ...current,
        deliveryAddress: current.deliveryAddress || address.street,
        neighborhood: current.neighborhood || address.neighborhood,
        city: current.city || address.city,
      }));
      setCepFeedback({ type: "success", message: "Endereço preenchido. Confira os dados antes de salvar." });
    } catch (error) {
      if (requestId !== cepLookupRequest.current) return;
      setCepFeedback({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "Não foi possível consultar o CEP agora. Tente novamente ou preencha manualmente.",
      });
    }
  }

  async function removeAddress(address: CustomerAddress) {
    if (!supabase || !window.confirm(`Remover o endereço "${address.label}"?`)) return;
    setAccountError("");
    setNotice("");
    const { error } = await supabase
      .from("customer_addresses")
      .delete()
      .eq("id", address.id);
    if (error) {
      setAccountError(`Não foi possível remover o endereço: ${error.message}`);
      return;
    }
    setAddresses((current) => current.filter((item) => item.id !== address.id));
    setNotice("Endereço removido.");
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAccountError(`Não foi possível sair da conta: ${error.message}`);
      return;
    }
    window.location.replace(appPath("login"));
  }

  if (!isSupabaseConfigured || !supabase) {
    return (
      <main className="customer-page">
        <section className="customer-auth-card">
          <a className="customer-brand" href={appPath()}><img src="/kit-feira-logo.png" alt="Kit Feira" /></a>
          <div className="customer-error" role="alert">O login de clientes precisa da conexão com o Supabase configurada.</div>
          <a className="customer-back-link" href={appPath()}><ArrowLeft size={15} /> Voltar à loja</a>
        </section>
      </main>
    );
  }

  if (checkingSession || (!accountRoute && session)) {
    return <main className="customer-loading"><LoaderCircle className="spin" size={23} /> Preparando sua conta...</main>;
  }

  if (session) {
    const displayName = profile?.full_name || profileName || String(session.user.user_metadata.full_name ?? "Cliente");
    const totalOrders = orders.filter((order) => order.status !== "cancelled").length;
    return (
      <main className="customer-page customer-account-page">
        <header className="customer-topbar">
          <a className="customer-brand" href={appPath()}><img src="/kit-feira-logo.png" alt="Kit Feira" /></a>
          <a className="customer-back-link" href={appPath()}><ArrowLeft size={15} /> Voltar à loja</a>
        </header>
        <div className="customer-account-wrap">
          <section className="customer-welcome">
            <div className="customer-avatar"><UserRound size={22} /></div>
            <div className="customer-welcome-copy">
              <span>MINHA CONTA KIT FEIRA</span>
              <h1>Oi, {displayName.split(" ")[0] || "tudo bem"}!</h1>
              <p>Acompanhe seus pedidos e mantenha seus dados de entrega por perto.</p>
            </div>
            <button type="button" className="customer-signout" onClick={() => void signOut()}>
              <LogOut size={15} /> Sair
            </button>
          </section>

          <section className="customer-summary">
            <article><ShoppingBag size={18} /><span>Pedidos registrados</span><strong>{orders.length}</strong></article>
            <article><PackageCheck size={18} /><span>Compras não canceladas</span><strong>{totalOrders}</strong></article>
            <article><Home size={18} /><span>Endereços salvos</span><strong>{addresses.length}</strong></article>
          </section>

          <section className="customer-workspace">
            <nav className="customer-tabs" aria-label="Seções da conta">
              <button type="button" className={accountTab === "orders" ? "active" : ""} onClick={() => setAccountTab("orders")}><ShoppingBag size={15} /> Meus pedidos</button>
              <button type="button" className={accountTab === "addresses" ? "active" : ""} onClick={() => setAccountTab("addresses")}><MapPin size={15} /> Endereços</button>
              <button type="button" className={accountTab === "profile" ? "active" : ""} onClick={() => setAccountTab("profile")}><UserRound size={15} /> Meus dados</button>
            </nav>
            <div className="customer-content">
              {accountError && <div className="customer-error" role="alert"><CircleAlert size={16} /> {accountError}</div>}
              {notice && <div className="customer-success" role="status"><Check size={16} /> {notice}</div>}
              {accountLoading ? (
                <div className="customer-loading-inline"><LoaderCircle className="spin" size={19} /> Carregando seus dados...</div>
              ) : (
                <>
                  {accountTab === "orders" && (
                    <div className="customer-panel">
                      <div className="customer-panel-heading"><div><span>SEU HISTÓRICO</span><h2>Meus pedidos</h2></div><Clock3 size={19} /></div>
                      {orders.length ? (
                        <div className="customer-order-list">
                          {orders.map((order) => (
                            <article className="customer-order-card" key={order.id}>
                              <div className="customer-order-top">
                                <div><small>PEDIDO #{order.id.slice(0, 8).toUpperCase()}</small><strong>{currency(order.total)}</strong></div>
                                <span className={`customer-order-status status-${order.status}`}>{orderStatusLabels[order.status]}</span>
                              </div>
                              <p className="customer-order-date">{dateTime(order.created_at)}</p>
                              <ul>{order.items.map((item, index) => <li key={`${order.id}-${index}`}>{item.quantity} {item.unit_label} · {item.kit_name} <strong>{currency(item.line_total)}</strong></li>)}</ul>
                              <details><summary>Endereço de entrega</summary><span>{order.delivery_address}, {order.address_number}</span>{order.complement && <span>{order.complement}</span>}<span>{order.neighborhood} · {order.city}{order.postal_code ? ` · CEP ${order.postal_code}` : ""}</span></details>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="customer-empty"><ShoppingBag size={25} /><strong>Seu primeiro pedido começa aqui</strong><span>Quando finalizar uma compra, ela ficará registrada nesta área.</span><a href={`${appPath()}#kits`}>Explorar a feira <ArrowRight size={15} /></a></div>
                      )}
                    </div>
                  )}

                  {accountTab === "addresses" && (
                    <div className="customer-panel">
                      <div className="customer-panel-heading"><div><span>ENTREGA SEM COMPLICAÇÃO</span><h2>Endereços salvos</h2></div><button type="button" className="customer-add-button" onClick={() => setAddressFormOpen((open) => !open)}><Plus size={15} /> Novo endereço</button></div>
                      {addressFormOpen && (
                        <form className="customer-address-form" onSubmit={(event) => void saveAddress(event)}>
                          <label>Nome do endereço<input value={addressDraft.label} onChange={(event) => setAddressDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Casa, trabalho..." maxLength={50} required /></label>
                          <label className="wide">Rua / avenida<input value={addressDraft.deliveryAddress} onChange={(event) => setAddressDraft((current) => ({ ...current, deliveryAddress: event.target.value }))} maxLength={180} required /></label>
                          <label>Número<input value={addressDraft.addressNumber} onChange={(event) => setAddressDraft((current) => ({ ...current, addressNumber: event.target.value }))} maxLength={30} required /></label>
                          <label>Bairro<input value={addressDraft.neighborhood} onChange={(event) => setAddressDraft((current) => ({ ...current, neighborhood: event.target.value }))} maxLength={100} required /></label>
                          <label>CEP<input value={addressDraft.postalCode} onChange={(event) => { cepLookupRequest.current += 1; setCepFeedback(null); setAddressDraft((current) => ({ ...current, postalCode: formatPostalCode(event.target.value) })); }} onBlur={() => void lookupAddressFromCep()} inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000" /></label>
                          {cepFeedback && <p className={`customer-cep-feedback ${cepFeedback.type}`} role={cepFeedback.type === "error" ? "alert" : "status"}>{cepFeedback.message}</p>}
                          <label>Cidade<input value={addressDraft.city} onChange={(event) => setAddressDraft((current) => ({ ...current, city: event.target.value }))} maxLength={100} required /></label>
                          <label className="wide">Complemento (opcional)<input value={addressDraft.complement} onChange={(event) => setAddressDraft((current) => ({ ...current, complement: event.target.value }))} maxLength={120} placeholder="Apartamento, casa, referência..." /></label>
                          <div className="customer-form-actions"><button type="button" className="customer-cancel-button" onClick={() => setAddressFormOpen(false)}>Cancelar</button><button type="submit" className="customer-primary-button" disabled={addressSaving}>{addressSaving ? <><LoaderCircle className="spin" size={15} /> Salvando...</> : <>Salvar endereço <ArrowRight size={15} /></>}</button></div>
                        </form>
                      )}
                      {addresses.length ? (
                        <div className="customer-address-list">
                          {addresses.map((address) => (
                            <article className="customer-address-card" key={address.id}>
                              <div className="customer-address-icon"><MapPin size={18} /></div>
                              <div><div className="customer-address-title"><strong>{address.label}</strong>{address.is_default && <span>Principal</span>}</div><p>{address.delivery_address}, {address.address_number}{address.complement ? ` · ${address.complement}` : ""}<br />{address.neighborhood} · {address.city}{address.postal_code ? ` · CEP ${address.postal_code}` : ""}</p></div>
                              <button type="button" aria-label={`Remover endereço ${address.label}`} onClick={() => void removeAddress(address)}><Trash2 size={16} /></button>
                            </article>
                          ))}
                        </div>
                      ) : !addressFormOpen ? (
                        <div className="customer-empty"><MapPin size={25} /><strong>Nenhum endereço salvo</strong><span>Salve um endereço aqui ou faça um pedido; o endereço será guardado automaticamente.</span><button type="button" onClick={() => setAddressFormOpen(true)}>Adicionar endereço <ArrowRight size={15} /></button></div>
                      ) : null}
                    </div>
                  )}

                  {accountTab === "profile" && (
                    <div className="customer-panel">
                      <div className="customer-panel-heading"><div><span>SEUS DADOS</span><h2>Dados pessoais</h2></div><ShieldCheck size={19} /></div>
                      <form className="customer-profile-form" onSubmit={(event) => void saveProfile(event)}>
                        <label>Nome completo<input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={3} maxLength={120} autoComplete="name" required /></label>
                        <label>E-mail<input type="email" value={session.user.email ?? ""} readOnly /></label>
                        <label>Celular com WhatsApp<input type="tel" value={profilePhone} onChange={(event) => setProfilePhone(formatPhone(event.target.value))} autoComplete="tel" maxLength={20} /></label>
                        <button type="submit" className="customer-primary-button" disabled={profileSaving}>{profileSaving ? <><LoaderCircle className="spin" size={15} /> Salvando...</> : <>Salvar meus dados <ArrowRight size={15} /></>}</button>
                      </form>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
          <p className="customer-account-footnote"><ShieldCheck size={14} /> Seus dados e pedidos são privados e protegidos pela sua conta.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="customer-page">
      <a className="customer-back-link customer-auth-back" href={appPath()}><ArrowLeft size={15} /> Voltar à loja</a>
      <section className="customer-auth-card">
        <a className="customer-brand" href={appPath()}><img src="/kit-feira-logo.png" alt="Kit Feira" /></a>
        <span className="customer-auth-kicker">SUA FEIRA, SEU ESPAÇO</span>
        <h1>{mode === "login" ? <>Que bom ter você<br /><span>de volta!</span></> : <>Crie sua conta<br /><span>em instantes.</span></>}</h1>
        <p>{mode === "login" ? "Entre para acompanhar pedidos e guardar seus endereços de entrega." : "Com uma conta, seus endereços e compras ficam salvos para a próxima feira."}</p>
        <div className="customer-auth-tabs" role="tablist" aria-label="Acesso à conta">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setAuthError(""); setAuthNotice(""); }}>Entrar</button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setAuthError(""); setAuthNotice(""); }}>Criar conta</button>
        </div>
        <form className="customer-auth-form" onSubmit={(event) => void submitAuth(event)}>
          {mode === "signup" && (
            <>
              <label>Nome completo<input autoComplete="name" value={authName} onChange={(event) => setAuthName(event.target.value)} minLength={3} maxLength={120} placeholder="Como podemos te chamar?" required /></label>
              <label>Celular com WhatsApp <span>(opcional)</span><input type="tel" autoComplete="tel" inputMode="tel" value={authPhone} onChange={(event) => setAuthPhone(formatPhone(event.target.value))} maxLength={20} placeholder="(11) 99999-9999" /></label>
            </>
          )}
          <label>E-mail<input type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} maxLength={254} placeholder="voce@email.com" required /></label>
          <label>Senha<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} minLength={8} placeholder={mode === "login" ? "Sua senha" : "Crie uma senha com 8+ caracteres"} required /></label>
          {mode === "signup" && <label>Confirmar senha<input type="password" autoComplete="new-password" value={authPasswordConfirmation} onChange={(event) => setAuthPasswordConfirmation(event.target.value)} minLength={8} placeholder="Digite a senha novamente" required /></label>}
          {authError && <div className="customer-error" role="alert"><CircleAlert size={16} /> {authError}</div>}
          {authNotice && <div className="customer-success" role="status"><Check size={16} /> {authNotice}</div>}
          <button type="submit" className="customer-primary-button customer-auth-submit" disabled={authSubmitting}>
            {authSubmitting ? <><LoaderCircle className="spin" size={17} /> Aguarde...</> : <>{mode === "login" ? "Entrar na minha conta" : "Criar minha conta"} <ArrowRight size={17} /></>}
          </button>
        </form>
        <div className="customer-auth-secure"><ShieldCheck size={15} /> Acesso seguro via Supabase Auth</div>
        <a className="customer-admin-link" href={appPath("admin")}>Acesso administrativo</a>
      </section>
      <div className="customer-auth-decoration"><span>🍊</span><div><strong>Kit Feira</strong><small>fresquinho do seu jeito</small></div><span>🍌</span></div>
    </main>
  );
}
