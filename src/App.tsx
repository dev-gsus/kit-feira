import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Gift,
  LoaderCircle,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  ShoppingBag,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import {
  appPath,
  isAdminPath,
  isCustomerAccountPath,
  isCustomerLoginPath,
} from "./lib/routes";
import MarketplaceStore from "./MarketplaceStore";

const AdminApp = lazy(() => import("./Admin"));
const CustomerAccount = lazy(() => import("./CustomerAccount"));

type Raffle = {
  id: string;
  title: string;
  description: string | null;
  rules: string | null;
  prize: string;
  draw_at: string;
  starts_at: string;
  ends_at: string;
  photo_url: string | null;
  max_participants: number | null;
  status: "active" | "paused" | "finished";
};

type Winner = {
  id: string;
  winner_name: string;
  prize: string;
  drawn_at: string;
  raffle: { title: string } | { title: string }[] | null;
};

const onlyDigits = (value: string) => value.replace(/\D/g, "");

function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (slice: string, factor: number) => {
    const sum = [...slice].reduce(
      (total, digit) => total + Number(digit) * factor--,
      0,
    );
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return (
    calculateDigit(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    calculateDigit(cpf.slice(0, 10), 11) === Number(cpf[10])
  );
}

function formatCpf(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function Brand() {
  return (
    <a className="brand" href="#inicio" aria-label="Kit Feira, início">
      <img className="brand-logo" src="/kit-feira-logo.png" alt="Kit Feira — Na sua porta" />
    </a>
  );
}

function CustomerAuthLink({ className }: { className?: string }) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <a className={className} href={appPath(signedIn ? "conta" : "login")}>
      {signedIn ? "Minha conta" : "Login"}
    </a>
  );
}

function PublicSite() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [selectedRaffleId, setSelectedRaffleId] = useState("");
  const [raffleLinkCopied, setRaffleLinkCopied] = useState(false);
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const raffle = raffles.find((item) => item.id === selectedRaffleId) ?? null;
  const registrationCount = raffle ? registrationCounts[raffle.id] ?? 0 : 0;

  useEffect(() => {
    const requestedRaffleId = new URLSearchParams(window.location.search).get("sorteio");
    if (
      !loading &&
      raffle &&
      raffle.id === requestedRaffleId &&
      window.location.hash === "#form-inscricao"
    ) {
      document.getElementById("form-inscricao")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading, raffle]);

  useEffect(() => {
    let active = true;

    async function loadPageData() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const client = supabase;

      const [raffleResult, winnersResult] = await Promise.all([
        client
          .from("raffles")
          .select("id, title, description, rules, prize, draw_at, starts_at, ends_at, photo_url, max_participants, status")
          .eq("is_active", true)
          .eq("status", "active")
          .lte("starts_at", new Date().toISOString())
          .gte("ends_at", new Date().toISOString())
          .order("draw_at", { ascending: true }),
        client
          .from("draw_results")
          .select("id, winner_name, prize, drawn_at, raffle:raffles(title)")
          .eq("is_published", true)
          .order("drawn_at", { ascending: false })
          .limit(3),
      ]);

      if (!active) return;
      if (raffleResult.error || winnersResult.error) {
        const errorCode = raffleResult.error?.code ?? winnersResult.error?.code;
        setLoadError(
          errorCode && ["PGRST202", "PGRST204", "PGRST205"].includes(errorCode)
            ? "O banco está conectado, mas precisa da atualização mais recente. Execute o arquivo supabase/schema.sql no Supabase."
            : "Não foi possível carregar as informações agora. Tente novamente mais tarde.",
        );
      } else {
        const availableRaffles = (raffleResult.data ?? []) as Raffle[];
        setRaffles(availableRaffles);
        setWinners((winnersResult.data ?? []) as Winner[]);
        const requestedRaffleId = new URLSearchParams(window.location.search).get("sorteio");
        setSelectedRaffleId((current) =>
          availableRaffles.some((item) => item.id === current)
            ? current
            : availableRaffles.some((item) => item.id === requestedRaffleId)
              ? requestedRaffleId!
              : availableRaffles[0]?.id ?? "",
        );
        const countResults = await Promise.all(
          availableRaffles.map(async (item) => ({
            id: item.id,
            result: await client.rpc("raffle_registration_count", {
              p_raffle_id: item.id,
            }),
          })),
        );
        if (!active) return;
        const failedCount = countResults.find(({ result }) => result.error);
        if (failedCount) {
          setLoadError("Não foi possível consultar as inscrições. Execute a versão atualizada de supabase/schema.sql no Supabase.");
        } else {
          setRegistrationCounts(
            countResults.reduce<Record<string, number>>((counts, { id, result }) => {
              counts[id] = Number(result.data ?? 0);
              return counts;
            }, {}),
          );
        }
      }
      setLoading(false);
    }

    void loadPageData();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage(null);

    if (!raffle || !supabase) {
      setFormMessage({
        type: "error",
        text: "Ainda não há um sorteio aberto para inscrições.",
      });
      return;
    }
    if (!isValidCpf(cpf)) {
      setFormMessage({ type: "error", text: "Confira o número do seu CPF." });
      return;
    }
    if (onlyDigits(phone).length < 10 || onlyDigits(phone).length > 15) {
      setFormMessage({ type: "error", text: "Confira o número do seu celular." });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("registrations").insert({
      raffle_id: raffle.id,
      full_name: name.trim(),
      cpf: onlyDigits(cpf),
      phone: onlyDigits(phone),
    });
    setSubmitting(false);

    if (error) {
      if (error.code === "23505") {
        setFormMessage({
          type: "error",
          text: "Este CPF já está inscrito neste sorteio.",
        });
      } else if (error.code === "42501") {
        setFormMessage({
          type: "error",
          text: "As inscrições para este sorteio não estão abertas.",
        });
      } else if (
        error.code === "P0001" &&
        error.message.toLowerCase().includes("limite")
      ) {
        setFormMessage({
          type: "error",
          text: "As vagas deste sorteio acabaram. Agradecemos seu interesse!",
        });
      } else {
        setFormMessage({
          type: "error",
          text: "Não foi possível concluir sua inscrição. Tente novamente.",
        });
      }
      return;
    }

    setFormMessage({
      type: "success",
      text: "Inscrição confirmada! Boa sorte, estamos na torcida.",
    });
    setName("");
    setCpf("");
    setPhone("");
    setRegistrationCounts((counts) => ({
      ...counts,
      [raffle.id]: (counts[raffle.id] ?? 0) + 1,
    }));
  }

  const raffleFull = Boolean(
    raffle?.max_participants !== null &&
      raffle?.max_participants !== undefined &&
      registrationCount >= raffle.max_participants,
  );
  const entryOpen = Boolean(
    raffle && isSupabaseConfigured && !loadError && !raffleFull,
  );

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(".reveal-on-scroll");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -24px 0px" },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <>
    <div className="site-shell" id="inicio">
      <header className="topbar">
        <div className="nav-wrap">
          <Brand />
          <CustomerAuthLink className="mobile-login-link" />
          <button
            className="mobile-menu"
            type="button"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
          <nav className={menuOpen ? "nav-links nav-open" : "nav-links"}>
            <a href="#kits" onClick={() => setMenuOpen(false)}>
              Monte sua feira
            </a>
            <a href="#como-funciona" onClick={() => setMenuOpen(false)}>
              Como comprar
            </a>
            <a href="#inscricao" onClick={() => setMenuOpen(false)}>
              Sorteios
            </a>
            <CustomerAuthLink className="nav-login" />
            <a className="nav-cta" href="#kits" onClick={() => setMenuOpen(false)}>
              Fazer meu pedido <ArrowRight size={16} />
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-content reveal-on-scroll">
            <div className="eyebrow"><span className="live-dot" /> Fresquinho do seu jeito</div>
            <h1>
              Sua feira,
              <br />
              <span>do seu jeito.</span>
            </h1>
            <p className="hero-copy">
              Monte sua feira escolhendo os produtos que quiser ou opte por um kit pronto. Receba em casa e confirme pelo WhatsApp.
            </p>
            <div className="hero-actions">
              <a className="button button-dark" href="#kits">
                Montar minha feira <ArrowRight size={17} />
              </a>
              <a className="text-link" href="#kits">
                Ver kits prontos <ArrowDown size={15} />
              </a>
            </div>
            <div className="hero-trust">
              <span className="hero-trust-icon"><ShoppingBag size={17} /></span>
              <p><strong>Pedido simples e seguro</strong><br />confirme sua entrega pelo WhatsApp</p>
            </div>
          </div>

          <div className="hero-art reveal-on-scroll reveal-delay-1" aria-label="Ilustração de uma banana sorridente">
            <div className="art-sun" />
            <div className="art-star star-one">✳</div>
            <div className="art-star star-two">✦</div>
            <div className="banana-wrap">
              <svg className="banana" viewBox="0 0 360 420" role="img" aria-hidden="true">
                <defs>
                  <linearGradient id="bananaFill" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffe966" />
                    <stop offset="1" stopColor="#f4c92f" />
                  </linearGradient>
                </defs>
                <path d="M66 51c18-12 40-3 43 15 6 36 11 70 29 104 25 46 69 70 131 57 16-3 30 9 28 25-8 66-54 116-121 129C90 400 12 326 18 229c4-62 20-134 48-178Z" fill="url(#bananaFill)" stroke="#d8a926" strokeWidth="5" strokeLinejoin="round"/>
                <path d="M65 52c11-10 26-15 41-11l7 31-37 13-21-10 10-23Z" fill="#765332"/>
                <path d="M296 236c8 2 14 9 13 18-3 18-10 35-20 50l-25-18 7-44 25-6Z" fill="#765332"/>
                <path d="M65 88c-19 53-30 111-23 160 8 62 50 107 109 118" fill="none" stroke="#fff3a8" strokeWidth="10" strokeLinecap="round" opacity=".8"/>
                <ellipse cx="145" cy="214" rx="8" ry="12" fill="#493626"/>
                <ellipse cx="194" cy="211" rx="8" ry="12" fill="#493626"/>
                <path d="M151 241c10 17 26 20 39 5" fill="none" stroke="#493626" strokeWidth="6" strokeLinecap="round"/>
                <ellipse cx="126" cy="233" rx="10" ry="6" fill="#f49b77" opacity=".7"/>
                <ellipse cx="213" cy="230" rx="10" ry="6" fill="#f49b77" opacity=".7"/>
              </svg>
              <span className="banana-caption">sua fruta favorita</span>
            </div>
            <div className="art-note"><Sparkles size={15} /> fresquinho e preparado com carinho</div>
          </div>
          <a className="scroll-cue" href="#kits" aria-label="Ver produtos e kits">
            <span />
          </a>
        </section>

        <section className="ticker reveal-on-scroll" aria-label="Kit Feira">
          <div className="ticker-track">
            {[0, 1, 2, 3].map((item) => (
            <span key={item}>KIT FEIRA · FRESQUINHO TODO DIA <b>✳</b> SEU PEDIDO, DO SEU JEITO <b>✳</b></span>
            ))}
          </div>
        </section>

        <MarketplaceStore />

        <section className="entry-section section-pad reveal-on-scroll" id="inscricao">
          <div className="section-intro">
          <span className="section-kicker">Sorteios Kit Feira</span>
          <h2>Uma chance<br /><span>para comemorar.</span></h2>
          <p>Além dos kits, acompanhe os sorteios e participe das campanhas abertas.</p>
            <div className="secure-note"><ShieldCheck size={18} /> Seus dados são tratados com cuidado e segurança.</div>
          </div>

          <div className="entry-card">
            {raffles.length > 1 && (
              <div className="raffle-selector">
                <span className="card-overline">ESCOLHA SEU SORTEIO</span>
                <div className="raffle-selector-list">
                  {raffles.map((item) => {
                    const count = registrationCounts[item.id] ?? 0;
                    const full =
                      item.max_participants !== null &&
                      count >= item.max_participants;
                    return (
                      <button
                        className={selectedRaffleId === item.id ? "raffle-choice selected" : "raffle-choice"}
                        type="button"
                        key={item.id}
                        aria-pressed={selectedRaffleId === item.id}
                        onClick={() => {
                          setSelectedRaffleId(item.id);
                          setFormMessage(null);
                        }}
                      >
                        <span><strong>{item.title}</strong><small>{item.prize}</small></span>
                        <span className={full ? "raffle-choice-status full" : "raffle-choice-status"}>
                          {full ? "Vagas preenchidas" : selectedRaffleId === item.id ? "Selecionado" : "Participar"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="entry-card-head">
              <div>
                <span className="card-overline">{raffles.length > 1 ? "SORTEIO SELECIONADO" : "SORTEIO ATUAL"}</span>
                <h3>{loading ? "Carregando sorteios..." : raffle?.title ?? "Nenhum sorteio aberto"}</h3>
              </div>
              <span className={entryOpen ? "status-pill" : "status-pill status-off"}>
                <span /> {raffleFull ? "Vagas preenchidas" : entryOpen ? "Inscrições abertas" : "Em breve"}
              </span>
            </div>

            {raffle && entryOpen && (
              <div className="raffle-live-callout">
                <span className="raffle-pulse-indicator" aria-hidden="true" />
                <div className="raffle-live-copy">
                  <strong>O sorteio está valendo!</strong>
                  <span>Inscreva-se e concorra a {raffle.prize}.</span>
                </div>
                <Sparkles size={18} aria-hidden="true" />
              </div>
            )}

            {raffle && (
              <div className="prize-banner">
                <span className="prize-icon"><Gift size={21} /></span>
                <div><small>VOCÊ PODE GANHAR</small><strong>{raffle.prize}</strong></div>
                <Sparkles className="prize-sparkle" size={20} />
              </div>
            )}
            {raffle && (
              <button
                className="raffle-share-link"
                type="button"
                onClick={async () => {
                  const url = new URL(window.location.href);
                  url.searchParams.set("sorteio", raffle.id);
                  url.hash = "form-inscricao";
                  try {
                    await navigator.clipboard.writeText(url.toString());
                    setRaffleLinkCopied(true);
                    window.setTimeout(() => setRaffleLinkCopied(false), 2200);
                  } catch {
                    window.prompt("Copie o link deste sorteio:", url.toString());
                  }
                }}
              >
                {raffleLinkCopied ? "Link do sorteio copiado!" : "Copiar link deste sorteio"}
              </button>
            )}
            {raffle && (
              <div className="raffle-group-rule">
                <ShieldCheck size={17} aria-hidden="true" />
                <p>
                  <strong>Regra para validar o prêmio</strong>
                  <span>O ganhador sorteado precisa estar no grupo oficial do Kit Feira para validar o prêmio. Se não estiver no grupo, realizaremos um novo sorteio.</span>
                </p>
              </div>
            )}
            {raffle && (raffle.photo_url || raffle.description || raffle.rules) && (
              <div className="raffle-public-details">
                {raffle.photo_url && <img src={raffle.photo_url} alt={`Prêmio: ${raffle.prize}`} />}
                <div>
                  {raffle.description && <p>{raffle.description}</p>}
                  {raffle.rules && <details><summary>Ver regras do sorteio</summary><p>{raffle.rules}</p></details>}
                </div>
              </div>
            )}
            {raffle && (
              <div className="raffle-capacity">
                <div>
                  <span>{raffle.max_participants === null ? "Participantes inscritos" : "Vagas preenchidas"}</span>
                  <strong>
                    {raffle.max_participants === null
                      ? registrationCount
                      : `${Math.min(registrationCount, raffle.max_participants)} de ${raffle.max_participants}`}
                  </strong>
                </div>
                {raffle.max_participants !== null && (
                  <div
                    className="capacity-track"
                    role="progressbar"
                    aria-label="Vagas preenchidas"
                    aria-valuemin={0}
                    aria-valuemax={raffle.max_participants}
                    aria-valuenow={Math.min(registrationCount, raffle.max_participants)}
                  >
                    <span style={{ width: `${Math.min(100, (registrationCount / raffle.max_participants) * 100)}%` }} />
                  </div>
                )}
              </div>
            )}

            {!isSupabaseConfigured && (
              <div className="inline-notice" role="status">
                O banco de dados precisa ser configurado para abrir as inscrições.
              </div>
            )}
            {loadError && <div className="inline-notice" role="alert">{loadError}</div>}
            {!loading && !raffle && isSupabaseConfigured && !loadError && (
              <div className="empty-raffle">
                <span className="empty-icon"><Gift size={21} /></span>
                <p>Não há inscrições abertas no momento.<br /><strong>Volte em breve para participar!</strong></p>
              </div>
            )}
            {raffleFull && (
              <div className="inline-notice" role="status">
                Este sorteio atingiu o limite de participantes. Acompanhe as próximas campanhas do Kit Feira!
              </div>
            )}

            <form className="entry-form" id="form-inscricao" onSubmit={handleSubmit}>
              <label>
                Seu nome completo
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder="Como podemos te chamar?"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  minLength={3}
                  maxLength={120}
                  required
                />
              </label>
              <div className="input-row">
                <label>
                  CPF
                  <input
                    type="text"
                    name="cpf"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="000.000.000-00"
                    value={cpf}
                    onChange={(event) => setCpf(formatCpf(event.target.value))}
                    maxLength={14}
                    required
                  />
                </label>
                <label>
                  Celular
                  <input
                    type="tel"
                    name="phone"
                    autoComplete="tel"
                    placeholder="(00) 00000-0000"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    maxLength={20}
                    required
                  />
                </label>
              </div>
              <label className="consent">
                <input type="checkbox" required />
                <span>Concordo com o regulamento e autorizo o uso dos meus dados para este sorteio.</span>
              </label>
              {formMessage && (
                <div className={`form-message ${formMessage.type}`} role="status">
                  {formMessage.type === "success" ? <Check size={17} /> : <CircleHelp size={17} />}
                  {formMessage.text}
                </div>
              )}
              <button
                className="button button-lime submit-button"
                type="submit"
                disabled={!entryOpen || loading || submitting}
              >
                {submitting ? <><LoaderCircle className="spin" size={17} /> Enviando...</> : <>Quero participar <ArrowRight size={17} /></>}
              </button>
              <p className="form-footnote"><ShieldCheck size={14} /> Uma inscrição por CPF neste sorteio.</p>
            </form>
          </div>
        </section>

        <section className="how-section section-pad reveal-on-scroll" id="como-funciona">
          <div className="how-heading">
            <span className="section-kicker">Seu pedido em poucos passos</span>
            <h2>É fácil. É rápido.<br /><span>É Kit Feira.</span></h2>
          </div>
          <div className="steps-grid">
            <article className="step-card">
              <span className="step-number">01</span>
              <div className="step-icon"><ShoppingBag size={22} /></div>
              <h3>Monte ou escolha</h3>
              <p>Combine produtos avulsos ou escolha um kit pronto, com preço visível antes de pedir.</p>
            </article>
            <article className="step-card">
              <span className="step-number">02</span>
              <div className="step-icon"><MapPin size={22} /></div>
              <h3>Informe a entrega</h3>
              <p>Preencha seus dados, endereço e forma de pagamento no checkout.</p>
            </article>
            <article className="step-card">
              <span className="step-number">03</span>
              <div className="step-icon"><MessageCircle size={22} /></div>
              <h3>Confirme no WhatsApp</h3>
              <p>Sua mensagem chega pronta para confirmar o pedido com a gente.</p>
            </article>
          </div>
        </section>

        <section className="results-section section-pad reveal-on-scroll" id="resultado">
          <div className="results-heading">
            <div>
              <span className="section-kicker">Campanhas e sorteios</span>
              <h2>Boas surpresas<br /><span>por aqui.</span></h2>
            </div>
            <p>Confira os resultados oficiais<br />das campanhas do Kit Feira.</p>
          </div>
          {loading ? (
            <div className="results-empty"><LoaderCircle className="spin" size={20} /> Carregando resultados...</div>
          ) : winners.length ? (
            <div className="winner-grid">
              {winners.map((winner) => (
                <article className="winner-card" key={winner.id}>
                  <div className="winner-icon"><Trophy size={20} /></div>
                  <span className="card-overline">
                    {(Array.isArray(winner.raffle) ? winner.raffle[0]?.title : winner.raffle?.title) ?? "SORTEIO KIT FEIRA"}
                  </span>
                  <h3>{winner.winner_name}</h3>
                  <p>Levou para casa <strong>{winner.prize}</strong></p>
                  <span className="winner-date">{formatDate(winner.drawn_at)}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="results-empty">
              <span className="results-empty-icon"><Trophy size={21} /></span>
              <p>Os próximos sorrisos podem ser os seus.<br /><strong>Em breve, novos resultados por aqui.</strong></p>
              <a href="#inscricao">Participar do sorteio <ArrowRight size={15} /></a>
            </div>
          )}
        </section>

        <section className="closing-cta reveal-on-scroll">
          <div className="closing-spark">✳</div>
          <p>Fresquinho, especial e do seu jeito.</p>
          <h2>Monte sua feira<br /><span>do seu jeito.</span></h2>
          <a className="button button-dark" href="#kits">Começar meu pedido <ArrowRight size={17} /></a>
          <div className="closing-banana">🍌</div>
        </section>
      </main>

      <footer className="footer">
        <Brand />
        <span>Produtos fresquinhos e pedidos preparados com carinho.</span>
        <a href="#inicio">Voltar ao topo <ChevronDown size={15} /></a>
        <CustomerAuthLink className="footer-customer-link" />
        <a className="footer-admin-link" href={appPath("admin")}>Acesso administrativo</a>
        <small>© {new Date().getFullYear()} Kit Feira. Fresquinho do seu jeito.</small>
        <small className="developer-credit">Desenvolvido por <a href="https://github.com/dev-gsus" target="_blank" rel="noreferrer">dev-gsus</a></small>
      </footer>
    </div>
    <a
      className="whatsapp-float"
      href="https://wa.me/5511970773006?text=Ol%C3%A1%21%20Quero%20saber%20mais%20sobre%20a%20feira."
      target="_blank"
      rel="noreferrer"
      aria-label="Fale com o Kit Feira pelo WhatsApp"
    >
      <span className="whatsapp-brand-icon" aria-hidden="true">
        <MessageCircle size={28} />
        <Phone className="whatsapp-phone-icon" size={12} />
      </span>
      <span className="whatsapp-tooltip">Fale com a gente</span>
    </a>
    </>
  );
}

function App() {
  const { pathname } = window.location;
  if (isAdminPath(pathname)) {
    return (
      <Suspense fallback={<div className="admin-loading">Carregando o painel...</div>}>
        <AdminApp />
      </Suspense>
    );
  }
  if (isCustomerLoginPath(pathname) || isCustomerAccountPath(pathname)) {
    return (
      <Suspense fallback={<div className="admin-loading">Carregando sua conta...</div>}>
        <CustomerAccount accountRoute={isCustomerAccountPath(pathname)} />
      </Suspense>
    );
  }
  return <PublicSite />;
}

export default App;
