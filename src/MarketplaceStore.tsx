import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  LoaderCircle,
  Megaphone,
  MapPin,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { lookupCep } from "./lib/cep";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import "./marketplace.css";

const whatsappNumber = "5511970773006";
const paymentLabels: Record<string, string> = {
  pix: "Pix",
  cash_on_delivery: "Dinheiro na entrega",
  card_on_delivery: "Cartão na entrega",
};

type MarketplaceKit = {
  id: string;
  name: string;
  description: string;
  contents: string;
  image_url: string | null;
  price: number;
  is_featured: boolean;
  product_type: "kit" | "loose";
  sale_unit: string;
};

type CartItem = {
  kit: MarketplaceKit;
  quantity: number;
};

type MarketplaceAnnouncement = {
  id: string;
  message: string;
  price: number | null;
  unit: string;
};

type CheckoutForm = {
  customerName: string;
  phone: string;
  address: string;
  addressNumber: string;
  neighborhood: string;
  complement: string;
  postalCode: string;
  city: string;
  paymentMethod: string;
};

type OrderSnapshot = {
  kit_name: string;
  quantity: number;
  unit_label: string;
  unit_price: number;
  line_total: number;
};

type CreatedOrder = {
  order_id: string;
  total: number;
  items: OrderSnapshot[];
};

type CheckoutConfirmation = {
  whatsappUrl: string;
  orderNumber: string;
  customerName: string;
};

function isCreatedOrder(value: unknown): value is CreatedOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as Record<string, unknown>;
  return (
    typeof order.order_id === "string" &&
    typeof order.total === "number" &&
    Array.isArray(order.items) &&
    order.items.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).kit_name === "string" &&
        typeof (item as Record<string, unknown>).quantity === "number" &&
        typeof (item as Record<string, unknown>).unit_label === "string" &&
        typeof (item as Record<string, unknown>).unit_price === "number" &&
        typeof (item as Record<string, unknown>).line_total === "number",
    )
  );
}

function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function unitLabel(product: MarketplaceKit) {
  return product.product_type === "kit" ? "kit" : product.sale_unit;
}

function quantityStep(product: MarketplaceKit) {
  return product.product_type === "loose" &&
    ["kg", "quilo"].includes(product.sale_unit.toLocaleLowerCase("pt-BR"))
    ? 0.5
    : 1;
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhone(value: string) {
  const phone = digits(value).slice(0, 11);
  if (phone.length < 3) return phone;
  if (phone.length < 8) return `(${phone.slice(0, 2)}) ${phone.slice(2)}`;
  return `(${phone.slice(0, 2)}) ${phone.slice(2, phone.length === 11 ? 7 : 6)}-${phone.slice(phone.length === 11 ? 7 : 6)}`;
}

function formatPostalCode(value: string) {
  const postalCode = digits(value).slice(0, 8);
  return postalCode.length > 5
    ? `${postalCode.slice(0, 5)}-${postalCode.slice(5)}`
    : postalCode;
}

function buildWhatsAppMessage(order: CreatedOrder, form: CheckoutForm) {
  const items = order.items
    .map(
      (item) =>
        `• ${formatQuantity(item.quantity)} ${item.unit_label} · ${item.kit_name} — ${currency(item.unit_price)} / ${item.unit_label} ( ${currency(item.line_total)} )`,
    )
    .join("\n");
  const postalCode = digits(form.postalCode);
  const address = [
    `${form.address.trim()}, ${form.addressNumber.trim()}`,
    form.complement.trim() ? `Compl.: ${form.complement.trim()}` : "",
    form.neighborhood.trim(),
    `${form.city.trim()}${postalCode ? ` · CEP ${postalCode}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `Olá! Quero confirmar o pedido ${order.order_id.slice(0, 8).toUpperCase()} do Kit Feira.`,
    "",
    "MEU PEDIDO",
    items,
    `Total: ${currency(order.total)}`,
    "",
    "ENTREGA",
    form.customerName.trim(),
    form.phone.trim(),
    address,
    "",
    `Pagamento: ${paymentLabels[form.paymentMethod]}`,
  ].join("\n");
}

function initialCheckoutForm(): CheckoutForm {
  return {
    customerName: "",
    phone: "",
    address: "",
    addressNumber: "",
    neighborhood: "",
    complement: "",
    postalCode: "",
    city: "",
    paymentMethod: "pix",
  };
}

export default function MarketplaceStore() {
  const [kits, setKits] = useState<MarketplaceKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [directPurchase, setDirectPurchase] = useState<{ product: MarketplaceKit; quantity: number } | null>(null);
  const [checkoutConfirmation, setCheckoutConfirmation] = useState<CheckoutConfirmation | null>(null);
  const [checkoutForm, setCheckoutForm] = useState<CheckoutForm>(initialCheckoutForm);
  const [checkoutError, setCheckoutError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customerGreetingName, setCustomerGreetingName] = useState("");
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
  const [cartFeedback, setCartFeedback] = useState("");
  const [cartPulse, setCartPulse] = useState(false);
  const [announcements, setAnnouncements] = useState<MarketplaceAnnouncement[]>([]);
  const [announcementError, setAnnouncementError] = useState("");
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [checkoutCepFeedback, setCheckoutCepFeedback] = useState<{ type: "loading" | "success" | "error"; message: string } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"all" | "kits" | "loose">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isCartFloating, setIsCartFloating] = useState(false);
  const storeSectionRef = useRef<HTMLElement>(null);
  const cartAnchorRef = useRef<HTMLDivElement>(null);
  const floatingCartRef = useRef<HTMLButtonElement>(null);
  const checkoutDialogRef = useRef<HTMLElement>(null);
  const directPurchaseDialogRef = useRef<HTMLElement>(null);
  const isSubmittingRef = useRef(false);
  const checkoutCepRequest = useRef(0);
  const cartFeedbackTimer = useRef<number | null>(null);
  isSubmittingRef.current = submitting;

  useEffect(() => {
    let active = true;

    async function loadKits() {
      if (!supabase) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("marketplace_kits")
        .select("id, name, description, contents, image_url, price, is_featured, product_type, sale_unit")
        .eq("is_active", true)
        .order("is_featured", { ascending: false })
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (!active) return;
      if (error) {
        setLoadError(
          ["PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")
            ? "A loja precisa da atualização mais recente do banco. Execute supabase/schema.sql no Supabase."
            : "Não foi possível carregar os kits agora. Tente novamente mais tarde.",
        );
      } else {
        setKits((data ?? []) as MarketplaceKit[]);
      }
      setLoading(false);
    }

    void loadKits();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;

    async function loadAnnouncements() {
      const { data, error } = await client
        .from("marketplace_announcements")
        .select("id, message, price, unit")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(12);

      if (!active) return;
      if (error) {
        setAnnouncementError(
          ["PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")
            ? "Novidades e ofertas da feira estão sendo preparadas. Em breve por aqui!"
            : "Não foi possível carregar os recados da feira agora.",
        );
        return;
      }
      setAnnouncements((data ?? []) as MarketplaceAnnouncement[]);
    }

    void loadAnnouncements();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;

    async function loadCustomerDefaults() {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (!active) return;
      if (sessionError) {
        setCheckoutError(`Não foi possível validar sua conta: ${sessionError.message}`);
        return;
      }
      if (!sessionData.session) return;

      const userId = sessionData.session.user.id;
      const metadataName = String(sessionData.session.user.user_metadata.full_name ?? "");
      setCustomerGreetingName(metadataName);
      const [profileResult, addressResult] = await Promise.all([
        client
          .from("customer_profiles")
          .select("full_name, phone")
          .eq("user_id", userId)
          .maybeSingle(),
        client
          .from("customer_addresses")
          .select("delivery_address, address_number, neighborhood, complement, postal_code, city")
          .eq("user_id", userId)
          .eq("is_default", true)
          .maybeSingle(),
      ]);
      if (!active) return;

      const loadError = profileResult.error ?? addressResult.error;
      if (loadError) {
        setCheckoutError(
          `Não foi possível carregar seus dados salvos: ${loadError.message}`,
        );
        return;
      }

      const profile = profileResult.data;
      const address = addressResult.data;
      setCustomerGreetingName(profile?.full_name || metadataName);
      setCheckoutForm((current) => ({
        ...current,
        customerName: current.customerName || profile?.full_name || metadataName,
        phone: current.phone || formatPhone(profile?.phone ?? String(sessionData.session.user.user_metadata.phone ?? "")),
        address: current.address || address?.delivery_address || "",
        addressNumber: current.addressNumber || address?.address_number || "",
        neighborhood: current.neighborhood || address?.neighborhood || "",
        complement: current.complement || address?.complement || "",
        postalCode: current.postalCode || formatPostalCode(address?.postal_code ?? ""),
        city: current.city || address?.city || "",
      }));
    }

    void loadCustomerDefaults();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!checkoutOpen && !directPurchase) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    const activeDialog = directPurchase
      ? directPurchaseDialogRef.current
      : checkoutDialogRef.current;
    const focusFrame = window.requestAnimationFrame(() => activeDialog?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmittingRef.current) {
        setCheckoutOpen(false);
        setDirectPurchase(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [checkoutOpen, directPurchase]);

  useEffect(() => {
    if (announcements.length < 2) return;
    const timer = window.setInterval(() => {
      setAnnouncementIndex((current) => (current + 1) % announcements.length);
    }, 5600);
    return () => window.clearInterval(timer);
  }, [announcements.length]);

  useEffect(() => () => {
    if (cartFeedbackTimer.current !== null) window.clearTimeout(cartFeedbackTimer.current);
  }, []);

  useEffect(() => {
    const originalCart = cartAnchorRef.current?.querySelector("button");
    const floatingCart = floatingCartRef.current;
    if (isCartFloating && document.activeElement === originalCart) {
      floatingCart?.focus({ preventScroll: true });
    } else if (!isCartFloating && document.activeElement === floatingCart) {
      originalCart?.focus({ preventScroll: true });
    }
  }, [isCartFloating]);

  useEffect(() => {
    let animationFrame = 0;
    const cartAnchor = cartAnchorRef.current;
    if (!cartAnchor) return;

    function updateFloatingCart() {
      animationFrame = 0;
      const storeSection = storeSectionRef.current;
      const currentCartAnchor = cartAnchorRef.current;
      if (!storeSection || !currentCartAnchor) return;
      const anchorBounds = currentCartAnchor.getBoundingClientRect();
      const sectionBounds = storeSection.getBoundingClientRect();
      const floating =
        anchorBounds.top < 16 &&
        sectionBounds.bottom > 16 + anchorBounds.height;
      setIsCartFloating((current) => current === floating ? current : floating);
    }

    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => {
          const currentSection = storeSectionRef.current;
          if (!currentSection) return;
          const sectionBounds = currentSection.getBoundingClientRect();
          const passedAnchor =
            !entry.isIntersecting && entry.boundingClientRect.bottom <= 16;
          const floating =
            passedAnchor &&
            sectionBounds.bottom > 16 + entry.boundingClientRect.height;
          setIsCartFloating((current) => current === floating ? current : floating);
        }, { rootMargin: "-16px 0px 0px 0px" })
      : null;
    observer?.observe(cartAnchor);

    function schedulePositionUpdate() {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateFloatingCart);
    }

    schedulePositionUpdate();
    window.addEventListener("scroll", schedulePositionUpdate, { passive: true });
    window.addEventListener("resize", schedulePositionUpdate);
    return () => {
      window.removeEventListener("scroll", schedulePositionUpdate);
      window.removeEventListener("resize", schedulePositionUpdate);
      observer?.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  const cartTotal = useMemo(
    () => cart.reduce((total, item) => total + item.kit.price * item.quantity, 0),
    [cart],
  );
  const cartProductCount = cart.length;
  const normalizedSearchTerm = normalizeSearchText(searchTerm.trim());
  const visibleProducts = useMemo(
    () => kits.filter((product) => {
      const matchesCategory =
        categoryFilter === "all" ||
        product.product_type === (categoryFilter === "kits" ? "kit" : "loose");
      const matchesSearch =
        !normalizedSearchTerm ||
        [product.name, product.description, product.contents, product.sale_unit]
          .some((value) => normalizeSearchText(value).includes(normalizedSearchTerm));
      return matchesCategory && matchesSearch;
    }),
    [categoryFilter, kits, normalizedSearchTerm],
  );

  const currentAnnouncement = announcements.length
    ? announcements[announcementIndex % announcements.length]
    : null;

  function selectedQuantity(product: MarketplaceKit) {
    return selectedQuantities[product.id] ?? quantityStep(product);
  }

  function changeSelectedQuantity(product: MarketplaceKit, delta: number) {
    const step = quantityStep(product);
    setSelectedQuantities((current) => {
      const currentValue = current[product.id] ?? step;
      const nextValue = Math.min(20, Math.max(step, Math.round((currentValue + delta) * 1000) / 1000));
      return { ...current, [product.id]: nextValue };
    });
  }

  function addToCart(kit: MarketplaceKit, quantity: number) {
    setCart((current) => {
      const existing = current.find((item) => item.kit.id === kit.id);
      if (!existing) return [...current, { kit, quantity }];
      return current.map((item) =>
        item.kit.id === kit.id
          ? {
              ...item,
              kit,
              quantity: Math.min(20, Math.round((item.quantity + quantity) * 1000) / 1000),
            }
          : item,
      );
    });
    setCheckoutConfirmation(null);
    setCheckoutError("");
    setCartFeedback(`${formatQuantity(quantity)} ${unitLabel(kit)} · ${kit.name} adicionado à sacola`);
    setCartPulse(true);
    if (cartFeedbackTimer.current !== null) window.clearTimeout(cartFeedbackTimer.current);
    cartFeedbackTimer.current = window.setTimeout(() => {
      setCartFeedback("");
      setCartPulse(false);
      cartFeedbackTimer.current = null;
    }, 1900);
  }

  function beginDirectPurchase(product: MarketplaceKit) {
    const quantity = selectedQuantity(product);
    addToCart(product, quantity);
    setDirectPurchase({ product, quantity });
  }

  function updateQuantity(kitId: string, delta: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.kit.id === kitId
              ? {
                  ...item,
                  quantity: Math.min(20, Math.round((item.quantity + delta) * 1000) / 1000),
                }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function updateCheckout<K extends keyof CheckoutForm>(
    key: K,
    value: CheckoutForm[K],
  ) {
    if (key === "postalCode") {
      checkoutCepRequest.current += 1;
      setCheckoutCepFeedback(null);
    }
    setCheckoutForm((current) => ({ ...current, [key]: value }));
    setCheckoutError("");
  }

  async function lookupCheckoutCep() {
    const cep = digits(checkoutForm.postalCode);
    if (cep.length !== 8) return;

    const requestId = ++checkoutCepRequest.current;
    setCheckoutCepFeedback({ type: "loading", message: "Buscando endereço pelo CEP..." });
    try {
      const address = await lookupCep(cep);
      if (requestId !== checkoutCepRequest.current) return;
      if (!address) {
        setCheckoutCepFeedback({ type: "error", message: "CEP não encontrado. Confira o número ou preencha o endereço manualmente." });
        return;
      }

      setCheckoutForm((current) => ({
        ...current,
        address: current.address || address.street,
        neighborhood: current.neighborhood || address.neighborhood,
        city: current.city || address.city,
      }));
      setCheckoutCepFeedback({ type: "success", message: "Endereço preenchido. Confira os dados antes de continuar." });
    } catch (error) {
      if (requestId !== checkoutCepRequest.current) return;
      setCheckoutCepFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível consultar o CEP agora. Tente novamente.",
      });
    }
  }

  function openCheckout() {
    setCheckoutError("");
    setDirectPurchase(null);
    setCheckoutOpen(true);
  }

  function finalizeDirectPurchase() {
    setCheckoutError("");
    setCheckoutConfirmation(null);
    setDirectPurchase(null);
    setCheckoutOpen(true);
  }

  async function submitCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckoutError("");
    if (!supabase || cart.length === 0) {
      setCheckoutError("Adicione produtos ou kits ao pedido antes de continuar.");
      return;
    }
    if (digits(checkoutForm.phone).length < 10 || digits(checkoutForm.phone).length > 15) {
      setCheckoutError("Confira o número do celular informado.");
      return;
    }
    if (
      checkoutForm.postalCode &&
      digits(checkoutForm.postalCode).length !== 8
    ) {
      setCheckoutError("O CEP deve conter 8 números.");
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.rpc("create_marketplace_order", {
      p_customer_name: checkoutForm.customerName.trim(),
      p_phone: digits(checkoutForm.phone),
      p_delivery_address: checkoutForm.address.trim(),
      p_address_number: checkoutForm.addressNumber.trim(),
      p_neighborhood: checkoutForm.neighborhood.trim(),
      p_complement: checkoutForm.complement.trim(),
      p_postal_code: digits(checkoutForm.postalCode),
      p_city: checkoutForm.city.trim(),
      p_payment_method: checkoutForm.paymentMethod,
      p_items: cart.map((item) => ({
        kit_id: item.kit.id,
        quantity: item.quantity,
      })),
    });
    setSubmitting(false);

    if (error) {
      setCheckoutError(
        error.code === "P0002"
          ? "Um dos produtos acabou de ficar indisponível. Atualize a página e tente novamente."
          : `Não foi possível registrar o pedido: ${error.message}`,
      );
      return;
    }
    if (!isCreatedOrder(data)) {
      setCheckoutError("O pedido foi recebido, mas não conseguimos preparar a mensagem. Fale com a loja pelo WhatsApp.");
      return;
    }

    const message = buildWhatsAppMessage(data, checkoutForm);
    setCart([]);
    setCheckoutConfirmation({
      whatsappUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`,
      orderNumber: data.order_id.slice(0, 8).toUpperCase(),
      customerName: customerGreetingName.trim() || checkoutForm.customerName.trim() || "Cliente",
    });
  }

  return (
    <section ref={storeSectionRef} className="kit-store-section section-pad reveal-on-scroll" id="kits">
      <div className="store-heading">
        <div>
          <span className="section-kicker">Produtos fresquinhos, do seu jeito</span>
          <h2>Monte sua feira<br /><span>como preferir.</span></h2>
        </div>
        <div className="store-heading-side">
          <p>Escolha produtos avulsos ou combine com kits prontos. Finalize pelo WhatsApp.</p>
        </div>
      </div>

      <div ref={cartAnchorRef} className="store-cart-anchor">
        <button
          className={`${isCartFloating ? "store-cart-button store-cart-button-placeholder" : "store-cart-button"}${cartPulse ? " store-cart-button-bump" : ""}`}
          type="button"
          onClick={openCheckout}
          aria-label={`Abrir pedido, ${cartProductCount} ${cartProductCount === 1 ? "produto" : "produtos"}`}
        >
          <ShoppingBag size={17} /> Meu pedido
          <span>{cartProductCount}</span>
        </button>
      </div>

      {isCartFloating && createPortal(
        <button
          ref={floatingCartRef}
          className={`store-cart-button store-cart-floating${cartPulse ? " store-cart-button-bump" : ""}`}
          type="button"
          onClick={openCheckout}
          aria-label={`Abrir pedido, ${cartProductCount} ${cartProductCount === 1 ? "produto" : "produtos"}`}
        >
          <ShoppingBag size={17} /> Meu pedido
          <span>{cartProductCount}</span>
        </button>,
        document.body,
      )}

      <div className={isCartFloating ? "store-products-toolbar cart-floating-active" : "store-products-toolbar"}>
        <div className="store-search" role="search" aria-label="Buscar no marketplace">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar fruta, produto ou kit"
            aria-label="Buscar produtos e kits"
          />
          {searchTerm && (
            <button type="button" onClick={() => setSearchTerm("")} aria-label="Limpar busca">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="store-category-tabs" role="group" aria-label="Filtrar produtos">
          {([
            ["all", "Tudo"],
            ["loose", "Montar minha feira"],
            ["kits", "Kits prontos"],
          ] as const).map(([category, label]) => (
            <button
              key={category}
              className={categoryFilter === category ? "store-category-tab active" : "store-category-tab"}
              type="button"
              aria-pressed={categoryFilter === category}
              onClick={() => setCategoryFilter(category)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!isSupabaseConfigured && (
        <div className="store-empty" role="status">
          A loja está sendo preparada. Volte em breve para montar sua feira.
        </div>
      )}
      {loadError && <div className="store-error" role="alert">{loadError}</div>}
      {loading ? (
        <div className="store-loading"><LoaderCircle className="spin" size={20} /> Carregando produtos...</div>
      ) : visibleProducts.length ? (
        <div className="store-grid">
          {visibleProducts.map((kit, index) => (
            <article
              className={`store-card${kit.is_featured && kit.product_type === "kit" ? " store-card-featured" : ""}`}
              key={kit.id}
              style={{ animationDelay: `${Math.min(index, 6) * 70}ms` }}
            >
              <div className="store-card-photo">
                {kit.image_url ? (
                  <img src={kit.image_url} alt={kit.name} loading="lazy" />
                ) : (
                  <div className="store-photo-placeholder" aria-hidden="true">
                    <span>🍊</span><span>🍌</span><span>🍓</span>
                  </div>
                )}
                {kit.is_featured && kit.product_type === "kit" && <span className="store-featured-badge">Mais pedido</span>}
                {kit.product_type === "loose" && <span className="store-featured-badge">Avulso · {kit.sale_unit}</span>}
                <span className="store-photo-mark"><ShoppingBag size={15} /></span>
              </div>
              <div className="store-card-content">
                <div className="store-kit-title">
                  <h3>{kit.name}</h3>
                  <strong>{currency(kit.price)} <small>/ {unitLabel(kit)}</small></strong>
                </div>
                <p>{kit.description}</p>
                {kit.product_type === "kit" && kit.contents && (
                  <div className="store-kit-contents">
                    <span>Vai no kit</span>
                    <p>{kit.contents}</p>
                  </div>
                )}
                <div className="store-product-quantity">
                  <span>{unitLabel(kit) === "kg" || unitLabel(kit) === "quilo" ? "Quanto você quer?" : "Quantidade"}</span>
                  <div className="store-product-quantity-control">
                    <button
                      type="button"
                      onClick={() => changeSelectedQuantity(kit, -quantityStep(kit))}
                      disabled={selectedQuantity(kit) <= quantityStep(kit)}
                      aria-label={`Diminuir quantidade de ${kit.name}`}
                    >
                      <Minus size={13} />
                    </button>
                    <strong>{formatQuantity(selectedQuantity(kit))} <small>{unitLabel(kit)}</small></strong>
                    <button
                      type="button"
                      onClick={() => changeSelectedQuantity(kit, quantityStep(kit))}
                      disabled={selectedQuantity(kit) >= 20}
                      aria-label={`Aumentar quantidade de ${kit.name}`}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
                <div className="store-card-actions">
                  <button
                    type="button"
                    className="store-add-button"
                    onClick={() => addToCart(kit, selectedQuantity(kit))}
                  >
                    <ShoppingBag size={15} /> Adicionar à sacola
                  </button>
                  <button
                    type="button"
                    className="store-buy-button"
                    onClick={() => beginDirectPurchase(kit)}
                  >
                    Comprar direto <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : !loadError && isSupabaseConfigured ? (
        <div className="store-empty">
          {searchTerm.trim()
            ? `Nenhum resultado para "${searchTerm.trim()}". Tente outra busca.`
            : kits.length
            ? "Ainda não há itens nesta categoria. Escolha outra opção para continuar."
            : "Estamos preparando os primeiros produtos. Em breve você poderá montar sua feira por aqui."}
        </div>
      ) : null}
      {announcementError && (
        <p className="store-announcement-error" role="status">{announcementError}</p>
      )}
      {cartFeedback && createPortal(
        <div className="store-cart-feedback" role="status" aria-live="polite">
          <Check size={16} /> {cartFeedback}
        </div>,
        document.body,
      )}
      {currentAnnouncement && createPortal(
        <aside
          key={currentAnnouncement.id}
          className="store-announcement-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span><Megaphone size={14} /> Recado da feira</span>
          <strong>{currentAnnouncement.message}</strong>
          {currentAnnouncement.price !== null && (
            <small>
              {currency(currentAnnouncement.price)}
              {currentAnnouncement.unit ? ` / ${currentAnnouncement.unit}` : ""}
            </small>
          )}
        </aside>,
        document.body,
      )}
      <p className="store-footnote"><Check size={14} /> Pedido enviado pelo WhatsApp para confirmar entrega e pagamento.</p>

      {checkoutOpen && createPortal(
        <div
          className="checkout-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) {
              setCheckoutOpen(false);
            }
          }}
        >
          <section
            ref={checkoutDialogRef}
            className="checkout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            tabIndex={-1}
          >
            <header className="checkout-header">
              <div>
                <span className="checkout-kicker">{checkoutConfirmation ? "PEDIDO REGISTRADO" : "FALTA POUCO"}</span>
                <h2 id="checkout-title">{checkoutConfirmation ? "Sua compra está quase lá" : "Seu pedido"}</h2>
              </div>
              <button
                type="button"
                className="checkout-close"
                aria-label="Fechar pedido"
                onClick={() => setCheckoutOpen(false)}
                disabled={submitting}
              >
                <X size={19} />
              </button>
            </header>

            {checkoutConfirmation ? (
              <div className="checkout-confirmation">
                <span className="checkout-confirmation-icon"><Check size={23} /></span>
                <small>PEDIDO #{checkoutConfirmation.orderNumber}</small>
                <h3>Sua compra está quase finalizada, {checkoutConfirmation.customerName.split(" ")[0] || "Cliente"}!</h3>
                <p>Confira os itens e os dados de entrega na conversa. Toque abaixo para enviar o pedido à Kit Feira pelo WhatsApp.</p>
                <button
                  type="button"
                  className="checkout-submit"
                  onClick={() => window.location.assign(checkoutConfirmation.whatsappUrl)}
                >
                  Finalizar pedido pelo WhatsApp <ArrowRight size={17} />
                </button>
                <button
                  type="button"
                  className="checkout-confirmation-back"
                  onClick={() => {
                    setCheckoutConfirmation(null);
                    setCheckoutOpen(false);
                  }}
                >
                  Voltar à loja
                </button>
              </div>
            ) : cart.length ? (
              <>
                <div className="checkout-items">
                  {cart.map(({ kit, quantity }) => (
                    <article className="checkout-item" key={kit.id}>
                      {kit.image_url ? (
                        <img src={kit.image_url} alt="" />
                      ) : (
                        <span className="checkout-item-placeholder">🍊</span>
                      )}
                      <div className="checkout-item-info">
                        <strong>{kit.name}</strong>
                        <span>{currency(kit.price)} / {unitLabel(kit)}</span>
                      </div>
                        <div className="checkout-quantity" aria-label={`Quantidade de ${kit.name}`}>
                          <button type="button" onClick={() => updateQuantity(kit.id, -quantityStep(kit))} aria-label="Diminuir quantidade"><Minus size={13} /></button>
                          <span>{formatQuantity(quantity)}</span>
                          <button type="button" onClick={() => updateQuantity(kit.id, quantityStep(kit))} aria-label="Aumentar quantidade" disabled={quantity >= 20}><Plus size={13} /></button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="checkout-total"><span>Total do pedido</span><strong>{currency(cartTotal)}</strong></div>
                <div className="checkout-divider"><span>ENTREGA E PAGAMENTO</span><ChevronDown size={15} /></div>
                <form className="checkout-form" onSubmit={(event) => void submitCheckout(event)}>
                  <label>
                    Nome completo
                    <input
                      autoComplete="name"
                      value={checkoutForm.customerName}
                      onChange={(event) => updateCheckout("customerName", event.target.value)}
                      minLength={3}
                      maxLength={120}
                      placeholder="Como podemos te chamar?"
                      required
                    />
                  </label>
                  <label>
                    Celular com WhatsApp
                    <input
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      value={checkoutForm.phone}
                      onChange={(event) => updateCheckout("phone", formatPhone(event.target.value))}
                      placeholder="(11) 99999-9999"
                      maxLength={20}
                      required
                    />
                  </label>
                  <div className="checkout-address-label"><MapPin size={15} /> Onde entregamos?</div>
                  <div className="checkout-address-grid">
                    <label className="checkout-address-street">
                      Rua / avenida
                      <input
                        autoComplete="street-address"
                        value={checkoutForm.address}
                        onChange={(event) => updateCheckout("address", event.target.value)}
                        maxLength={180}
                        required
                      />
                    </label>
                    <label>
                      Número
                      <input
                        value={checkoutForm.addressNumber}
                        onChange={(event) => updateCheckout("addressNumber", event.target.value)}
                        maxLength={30}
                        required
                      />
                    </label>
                    <label>
                      Bairro
                      <input
                        autoComplete="address-level3"
                        value={checkoutForm.neighborhood}
                        onChange={(event) => updateCheckout("neighborhood", event.target.value)}
                        maxLength={100}
                        required
                      />
                    </label>
                    <label>
                      CEP <span>(opcional)</span>
                      <input
                        autoComplete="postal-code"
                        inputMode="numeric"
                        value={checkoutForm.postalCode}
                        onChange={(event) => updateCheckout("postalCode", formatPostalCode(event.target.value))}
                        onBlur={() => void lookupCheckoutCep()}
                        maxLength={9}
                        placeholder="00000-000"
                      />
                    </label>
                    <label>
                      Cidade
                      <input
                        autoComplete="address-level2"
                        value={checkoutForm.city}
                        onChange={(event) => updateCheckout("city", event.target.value)}
                        maxLength={100}
                        required
                      />
                    </label>
                    {checkoutCepFeedback && (
                      <p className={`checkout-cep-feedback ${checkoutCepFeedback.type}`} role={checkoutCepFeedback.type === "error" ? "alert" : "status"}>
                        {checkoutCepFeedback.message}
                      </p>
                    )}
                    <label className="checkout-address-street">
                      Complemento <span>(opcional)</span>
                      <input
                        autoComplete="address-line2"
                        value={checkoutForm.complement}
                        onChange={(event) => updateCheckout("complement", event.target.value)}
                        maxLength={120}
                        placeholder="Apartamento, casa, referência..."
                      />
                    </label>
                  </div>
                  <label>
                    Forma de pagamento
                    <select
                      value={checkoutForm.paymentMethod}
                      onChange={(event) => updateCheckout("paymentMethod", event.target.value)}
                    >
                      <option value="pix">Pix</option>
                      <option value="cash_on_delivery">Dinheiro na entrega</option>
                      <option value="card_on_delivery">Cartão na entrega</option>
                    </select>
                  </label>

                  <label className="checkout-consent">
                    <input type="checkbox" required />
                    <span>Autorizo o uso destes dados para processar e confirmar a entrega deste pedido.</span>
                  </label>
                  {checkoutError && <div className="checkout-error" role="alert">{checkoutError}</div>}
                  <button className="checkout-submit" type="submit" disabled={submitting}>
                    {submitting ? (
                      <><LoaderCircle className="spin" size={17} /> Preparando seu pedido...</>
                    ) : (
                      <>Preparar pedido <ArrowRight size={17} /></>
                    )}
                  </button>
                  <p className="checkout-privacy">Ao continuar, seus dados serão usados para organizar a entrega deste pedido.</p>
                </form>
              </>
            ) : (
              <div className="checkout-empty">
                <ShoppingBag size={25} />
                <h3>Sua sacola está vazia</h3>
                <p>Escolha um produto ou kit para começar seu pedido.</p>
                <button type="button" onClick={() => setCheckoutOpen(false)}>Continuar comprando</button>
              </div>
            )}
          </section>
        </div>,
        document.body,
      )}

      {directPurchase && createPortal(
        <div
          className="checkout-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDirectPurchase(null);
          }}
        >
          <section
            ref={directPurchaseDialogRef}
            className="direct-purchase-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="direct-purchase-title"
            tabIndex={-1}
          >
            <button
              type="button"
              className="checkout-close direct-purchase-close"
              aria-label="Fechar"
              onClick={() => setDirectPurchase(null)}
            >
              <X size={18} />
            </button>
            <span className="direct-purchase-icon"><ShoppingBag size={21} /></span>
            <span className="checkout-kicker">ESCOLHA O PRÓXIMO PASSO</span>
            <h2 id="direct-purchase-title">Boa escolha!</h2>
            <p className="direct-purchase-item">
              {formatQuantity(directPurchase.quantity)} {unitLabel(directPurchase.product)} · {directPurchase.product.name}
            </p>
            <p>O produto já está na sua sacola. Quer continuar escolhendo ou seguir para finalizar o pedido?</p>
            <div className="direct-purchase-actions">
              <button type="button" className="direct-purchase-continue" onClick={() => setDirectPurchase(null)}>
                Continuar comprando
              </button>
              <button type="button" className="direct-purchase-finish" onClick={finalizeDirectPurchase}>
                Finalizar compra <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </section>
  );
}
