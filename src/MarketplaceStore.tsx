import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  LoaderCircle,
  MapPin,
  Minus,
  Plus,
  ShoppingBag,
  X,
} from "lucide-react";
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
};

type CartItem = {
  kit: MarketplaceKit;
  quantity: number;
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
  unit_price: number;
  line_total: number;
};

type CreatedOrder = {
  order_id: string;
  total: number;
  items: OrderSnapshot[];
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
        `• ${item.quantity}x ${item.kit_name} — ${currency(item.unit_price)} cada ( ${currency(item.line_total)} )`,
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
  const [checkoutForm, setCheckoutForm] = useState<CheckoutForm>(initialCheckoutForm);
  const [checkoutError, setCheckoutError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadKits() {
      if (!supabase) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("marketplace_kits")
        .select("id, name, description, contents, image_url, price, is_featured")
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

  const cartTotal = useMemo(
    () => cart.reduce((total, item) => total + item.kit.price * item.quantity, 0),
    [cart],
  );
  const cartQuantity = useMemo(
    () => cart.reduce((total, item) => total + item.quantity, 0),
    [cart],
  );

  function addToCart(kit: MarketplaceKit) {
    setCart((current) => {
      const existing = current.find((item) => item.kit.id === kit.id);
      if (!existing) return [...current, { kit, quantity: 1 }];
      return current.map((item) =>
        item.kit.id === kit.id
          ? { ...item, kit, quantity: Math.min(item.quantity + 1, 20) }
          : item,
      );
    });
    setCheckoutError("");
    setCheckoutOpen(true);
  }

  function updateQuantity(kitId: string, delta: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.kit.id === kitId
            ? { ...item, quantity: Math.min(20, item.quantity + delta) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function updateCheckout<K extends keyof CheckoutForm>(
    key: K,
    value: CheckoutForm[K],
  ) {
    setCheckoutForm((current) => ({ ...current, [key]: value }));
  }

  async function submitCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckoutError("");
    if (!supabase || cart.length === 0) {
      setCheckoutError("Adicione um kit ao pedido antes de continuar.");
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
          ? "Um dos kits acabou de ficar indisponível. Atualize a página e tente novamente."
          : `Não foi possível registrar o pedido: ${error.message}`,
      );
      return;
    }
    if (!isCreatedOrder(data)) {
      setCheckoutError("O pedido foi recebido, mas não conseguimos preparar a mensagem. Fale com a loja pelo WhatsApp.");
      return;
    }

    const message = buildWhatsAppMessage(data, checkoutForm);
    window.location.assign(
      `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`,
    );
  }

  return (
    <section className="kit-store-section section-pad" id="kits">
      <div className="store-heading">
        <div>
          <span className="section-kicker">Escolhas fresquinhas, feitas para você</span>
          <h2>Seu próximo favorito<br /><span>vem em um kit.</span></h2>
        </div>
        <div className="store-heading-side">
          <p>Monte seu pedido, informe onde entregar e finalize pelo WhatsApp.</p>
          <button
            className="store-cart-button"
            type="button"
            onClick={() => {
              setCheckoutError("");
              setCheckoutOpen(true);
            }}
            aria-label={`Abrir pedido, ${cartQuantity} itens`}
          >
            <ShoppingBag size={17} /> Meu pedido
            <span>{cartQuantity}</span>
          </button>
        </div>
      </div>

      {!isSupabaseConfigured && (
        <div className="store-empty" role="status">
          A loja está sendo preparada. Volte em breve para conhecer nossos kits.
        </div>
      )}
      {loadError && <div className="store-error" role="alert">{loadError}</div>}
      {loading ? (
        <div className="store-loading"><LoaderCircle className="spin" size={20} /> Carregando kits...</div>
      ) : kits.length ? (
        <div className="store-grid">
          {kits.map((kit, index) => (
            <article
              className={`store-card${kit.is_featured ? " store-card-featured" : ""}`}
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
                {kit.is_featured && <span className="store-featured-badge">Mais pedido</span>}
                <span className="store-photo-mark"><ShoppingBag size={15} /></span>
              </div>
              <div className="store-card-content">
                <div className="store-kit-title">
                  <h3>{kit.name}</h3>
                  <strong>{currency(kit.price)}</strong>
                </div>
                <p>{kit.description}</p>
                {kit.contents && (
                  <div className="store-kit-contents">
                    <span>Vai no kit</span>
                    <p>{kit.contents}</p>
                  </div>
                )}
                <button
                  type="button"
                  className="store-buy-button"
                  onClick={() => addToCart(kit)}
                >
                  Comprar este kit <ArrowRight size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : !loadError && isSupabaseConfigured ? (
        <div className="store-empty">
          {loading
            ? "Carregando os kits..."
            : "Estamos preparando os primeiros kits. Em breve você poderá pedir por aqui."}
        </div>
      ) : null}
      <p className="store-footnote"><Check size={14} /> Pedido enviado pelo WhatsApp para confirmar entrega e pagamento.</p>

      {checkoutOpen && (
        <div
          className="checkout-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) {
              setCheckoutOpen(false);
            }
          }}
        >
          <section
            className="checkout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
          >
            <header className="checkout-header">
              <div>
                <span className="checkout-kicker">Falta pouco</span>
                <h2 id="checkout-title">Seu pedido</h2>
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

            {cart.length ? (
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
                        <span>{currency(kit.price)} cada</span>
                      </div>
                      <div className="checkout-quantity" aria-label={`Quantidade de ${kit.name}`}>
                        <button type="button" onClick={() => updateQuantity(kit.id, -1)} aria-label="Diminuir quantidade"><Minus size={13} /></button>
                        <span>{quantity}</span>
                        <button type="button" onClick={() => updateQuantity(kit.id, 1)} aria-label="Aumentar quantidade" disabled={quantity >= 20}><Plus size={13} /></button>
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
                      <>Continuar no WhatsApp <ArrowRight size={17} /></>
                    )}
                  </button>
                  <p className="checkout-privacy">Ao continuar, seus dados serão usados para organizar a entrega deste pedido.</p>
                </form>
              </>
            ) : (
              <div className="checkout-empty">
                <ShoppingBag size={25} />
                <h3>Sua sacola está vazia</h3>
                <p>Escolha um kit para começar seu pedido.</p>
                <button type="button" onClick={() => setCheckoutOpen(false)}>Ver kits</button>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
