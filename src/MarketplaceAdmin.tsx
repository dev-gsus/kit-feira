import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import "./marketplace.css";

type AdminKit = {
  id: string;
  name: string;
  description: string;
  contents: string;
  image_url: string | null;
  price: number;
  product_type: "kit" | "loose";
  sale_unit: string;
  is_active: boolean;
  is_featured: boolean;
  display_order: number;
  created_at: string;
};

type OrderItem = {
  id: string;
  order_id: string;
  kit_name: string;
  quantity: number;
  unit_label: string;
  unit_price: number;
  line_total: number;
};

type MarketplaceOrder = {
  id: string;
  customer_name: string;
  phone: string;
  delivery_address: string;
  address_number: string;
  neighborhood: string;
  complement: string;
  postal_code: string;
  city: string;
  payment_method: string;
  status: "pending" | "confirmed" | "preparing" | "delivered" | "cancelled";
  total: number;
  created_at: string;
  items: OrderItem[];
};

type PurchaseCost = {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  total_cost: number;
  unit_cost: number;
  purchased_on: string;
  notes: string;
};

type MarketplaceSummary = {
  active_kits: number;
  total_orders: number;
  pending_orders: number;
  order_value: number;
  total_purchase_cost: number;
  today_orders: number;
};

type CustomerSummary = {
  user_id: string;
  email: string;
  full_name: string;
  phone: string;
  created_at: string;
  order_count: number;
  purchase_total: number;
  last_order_at: string | null;
};

type KitForm = {
  name: string;
  description: string;
  contents: string;
  price: string;
  product_type: "kit" | "loose";
  sale_unit: string;
  is_active: boolean;
  is_featured: boolean;
  display_order: string;
};

type CostForm = {
  itemName: string;
  quantity: string;
  unit: string;
  totalCost: string;
  purchasedOn: string;
  notes: string;
};

type CostComparison = {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  total_cost: number;
  unit_cost: number;
  purchased_on: string;
  previous_unit_cost: number | null;
  difference: number | null;
  difference_percent: number | null;
};

type StoreAnnouncement = {
  id: string;
  message: string;
  price: number | null;
  unit: string;
  is_active: boolean;
  created_at: string;
};

type AnnouncementForm = {
  message: string;
  price: string;
  unit: string;
};

type AdminSection = "overview" | "kits" | "orders" | "customers" | "announcements" | "costs";
type MarketplaceAdminProps = {
  compact?: boolean;
  onOpenStore?: () => void;
};

const paymentLabels: Record<string, string> = {
  pix: "Pix",
  cash_on_delivery: "Dinheiro na entrega",
  card_on_delivery: "Cartão na entrega",
};

const orderStatuses: MarketplaceOrder["status"][] = [
  "pending",
  "confirmed",
  "preparing",
  "delivered",
  "cancelled",
];

const orderStatusLabels: Record<MarketplaceOrder["status"], string> = {
  pending: "Aguardando WhatsApp",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

const emptyKitForm = (): KitForm => ({
  name: "",
  description: "",
  contents: "",
  price: "",
  product_type: "kit",
  sale_unit: "kit",
  is_active: true,
  is_featured: false,
  display_order: "0",
});

function todayDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyCostForm(): CostForm {
  return {
    itemName: "",
    quantity: "1",
    unit: "kg",
    totalCost: "",
    purchasedOn: todayDate(),
    notes: "",
  };
}

function emptyAnnouncementForm(): AnnouncementForm {
  return { message: "", price: "", unit: "" };
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

function displayDate(value: string) {
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    ...(value.length > 10 ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

function shortDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function phoneDigits(value: string) {
  const phone = value.replace(/\D/g, "");
  return phone.length > 11 && phone.startsWith("55") ? phone : `55${phone}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCostComparison(value: unknown): value is CostComparison {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.item_name === "string" &&
    typeof value.quantity === "number" &&
    typeof value.unit === "string" &&
    typeof value.total_cost === "number" &&
    typeof value.unit_cost === "number" &&
    typeof value.purchased_on === "string" &&
    (value.previous_unit_cost === null || typeof value.previous_unit_cost === "number") &&
    (value.difference === null || typeof value.difference === "number") &&
    (value.difference_percent === null || typeof value.difference_percent === "number")
  );
}

function databaseError(message: string, code?: string) {
  return code && ["PGRST202", "PGRST204", "PGRST205"].includes(code)
    ? "O banco ainda não tem as tabelas da loja. Execute novamente o arquivo supabase/schema.sql no Supabase."
    : message;
}

export default function MarketplaceAdmin({
  compact = false,
  onOpenStore,
}: MarketplaceAdminProps = {}) {
  const [section, setSection] = useState<AdminSection>("overview");
  const [kits, setKits] = useState<AdminKit[]>([]);
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [costs, setCosts] = useState<PurchaseCost[]>([]);
  const [summary, setSummary] = useState<MarketplaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kitForm, setKitForm] = useState<KitForm>(emptyKitForm);
  const [editingKitId, setEditingKitId] = useState<string | null>(null);
  const [isProductEditorOpen, setIsProductEditorOpen] = useState(false);
  const [kitImage, setKitImage] = useState<File | null>(null);
  const [costForm, setCostForm] = useState<CostForm>(emptyCostForm);
  const [costComparison, setCostComparison] = useState<CostComparison | null>(null);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerReload, setCustomerReload] = useState(0);
  const [announcements, setAnnouncements] = useState<StoreAnnouncement[]>([]);
  const [announcementForm, setAnnouncementForm] = useState<AnnouncementForm>(emptyAnnouncementForm);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementError, setAnnouncementError] = useState("");
  const [announcementReload, setAnnouncementReload] = useState(0);

  const recentOrders = useMemo(() => orders.slice(0, 5), [orders]);
  const visibleCustomers = useMemo(() => {
    const search = customerSearch.trim().toLocaleLowerCase("pt-BR");
    if (!search) return customers;
    return customers.filter((customer) =>
      [customer.full_name, customer.email, customer.phone]
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(search)),
    );
  }, [customerSearch, customers]);

  async function loadData() {
    if (!supabase) {
      setLoading(false);
      setError("O banco de dados não está configurado neste ambiente.");
      return;
    }

    setLoading(true);
    setError("");
    const [kitResult, orderResult, costResult, summaryResult] = await Promise.all([
      supabase
        .from("marketplace_kits")
        .select("id, name, description, contents, image_url, price, product_type, sale_unit, is_active, is_featured, display_order, created_at")
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("marketplace_orders")
        .select("id, customer_name, phone, delivery_address, address_number, neighborhood, complement, postal_code, city, payment_method, status, total, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("purchase_costs")
        .select("id, item_name, quantity, unit, total_cost, unit_cost, purchased_on, notes")
        .order("purchased_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.rpc("admin_marketplace_summary"),
    ]);

    const initialError =
      kitResult.error ?? orderResult.error ?? costResult.error ?? summaryResult.error;
    if (initialError) {
      setError(databaseError(initialError.message, initialError.code));
      setLoading(false);
      return;
    }

    const nextOrders = (orderResult.data ?? []) as Omit<MarketplaceOrder, "items">[];
    let orderItems: OrderItem[] = [];
    if (nextOrders.length > 0) {
      const { data, error: itemError } = await supabase
        .from("marketplace_order_items")
        .select("id, order_id, kit_name, quantity, unit_label, unit_price, line_total")
        .in("order_id", nextOrders.map((order) => order.id));
      if (itemError) {
        setError(`Não foi possível carregar os itens dos pedidos: ${itemError.message}`);
        setLoading(false);
        return;
      }
      orderItems = (data ?? []) as OrderItem[];
    }

    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const item of orderItems) {
      itemsByOrder.set(item.order_id, [
        ...(itemsByOrder.get(item.order_id) ?? []),
        item,
      ]);
    }
    const summaryData = summaryResult.data;
    const summaryRow = Array.isArray(summaryData) ? summaryData[0] : summaryData;
    setKits((kitResult.data ?? []) as AdminKit[]);
    setOrders(
      nextOrders.map((order) => ({
        ...order,
        items: itemsByOrder.get(order.id) ?? [],
      })),
    );
    setCosts((costResult.data ?? []) as PurchaseCost[]);
    setSummary(
      summaryRow
        ? (summaryRow as MarketplaceSummary)
        : {
            active_kits: 0,
            total_orders: 0,
            pending_orders: 0,
            order_value: 0,
            total_purchase_cost: 0,
            today_orders: 0,
          },
    );
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (section !== "customers") return;
    if (!supabase) {
      setCustomersError("O banco de dados não está configurado neste ambiente.");
      return;
    }

    let active = true;
    setCustomersLoading(true);
    setCustomersError("");
    void supabase.rpc("admin_customer_summary").then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setCustomersError(
          ["PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")
            ? "Para habilitar o CRM, aplique a migração supabase/migrations/20261123_customer_accounts_crm.sql no Supabase."
            : `Não foi possível carregar os clientes: ${error.message}`,
        );
        setCustomersLoading(false);
        return;
      }
      setCustomers((data ?? []) as CustomerSummary[]);
      setCustomersLoading(false);
    });
    return () => {
      active = false;
    };
  }, [customerReload, section]);

  useEffect(() => {
    if (section !== "announcements") return;
    if (!supabase) {
      setAnnouncementError("O banco de dados não está configurado neste ambiente.");
      return;
    }

    let active = true;
    setAnnouncementLoading(true);
    setAnnouncementError("");
    void supabase
      .from("marketplace_announcements")
      .select("id, message, price, unit, is_active, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setAnnouncementError(
            ["PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")
              ? "Aplique supabase/migrations/20261123_marketplace_announcements.sql para habilitar os recados da feira."
              : `Não foi possível carregar os recados: ${error.message}`,
          );
          setAnnouncementLoading(false);
          return;
        }
        setAnnouncements((data ?? []) as StoreAnnouncement[]);
        setAnnouncementLoading(false);
      });
    return () => {
      active = false;
    };
  }, [announcementReload, section]);

  function updateKitForm<K extends keyof KitForm>(key: K, value: KitForm[K]) {
    setKitForm((current) => ({ ...current, [key]: value }));
  }

  function editKit(kit: AdminKit) {
    setEditingKitId(kit.id);
    setKitForm({
      name: kit.name,
      description: kit.description,
      contents: kit.contents,
      price: String(kit.price),
      product_type: kit.product_type,
      sale_unit: kit.sale_unit,
      is_active: kit.is_active,
      is_featured: kit.is_featured,
      display_order: String(kit.display_order),
    });
    setKitImage(null);
    setNotice("");
    setError("");
    setIsProductEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelKitEdit() {
    setEditingKitId(null);
    setKitForm(emptyKitForm());
    setKitImage(null);
    setError("");
    setNotice("");
    setIsProductEditorOpen(false);
  }

  function startNewProduct() {
    setEditingKitId(null);
    setKitForm(emptyKitForm());
    setKitImage(null);
    setError("");
    setNotice("");
    setIsProductEditorOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveKit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    setNotice("");

    const price = Number(kitForm.price.replace(",", "."));
    const displayOrder = Number(kitForm.display_order);
    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(displayOrder)) {
      setError("Informe um valor válido e uma ordem de exibição inteira.");
      return;
    }
    if (kitImage && !["image/jpeg", "image/png", "image/webp"].includes(kitImage.type)) {
      setError("A foto deve estar no formato JPG, PNG ou WEBP.");
      return;
    }
    if (kitImage && kitImage.size > 5 * 1024 * 1024) {
      setError("A foto deve ter no máximo 5 MB.");
      return;
    }

    setSaving(true);
    let imageUrl = editingKitId
      ? kits.find((kit) => kit.id === editingKitId)?.image_url ?? null
      : null;
    if (kitImage) {
      const extension = kitImage.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("kit-images")
        .upload(path, kitImage, {
          upsert: false,
          contentType: kitImage.type,
        });
      if (uploadError) {
        setError(`Não foi possível enviar a foto: ${uploadError.message}`);
        setSaving(false);
        return;
      }
      imageUrl = supabase.storage.from("kit-images").getPublicUrl(path).data.publicUrl;
    }

    const values = {
      name: kitForm.name.trim(),
      description: kitForm.description.trim(),
      contents: kitForm.contents.trim(),
      price,
      image_url: imageUrl,
      product_type: kitForm.product_type,
      sale_unit: kitForm.product_type === "kit" ? "kit" : kitForm.sale_unit,
      is_active: kitForm.is_active,
      is_featured: kitForm.is_featured,
      display_order: displayOrder,
      updated_at: new Date().toISOString(),
    };
    const result = editingKitId
      ? await supabase.from("marketplace_kits").update(values).eq("id", editingKitId)
      : await supabase.from("marketplace_kits").insert(values);
    setSaving(false);

    if (result.error) {
      setError(databaseError(`Não foi possível salvar o kit: ${result.error.message}`, result.error.code));
      return;
    }

    setNotice(editingKitId ? "Produto atualizado com sucesso." : "Produto publicado na loja.");
    setEditingKitId(null);
    setKitForm(emptyKitForm());
    setKitImage(null);
    setIsProductEditorOpen(false);
    await loadData();
  }

  async function toggleKit(kit: AdminKit) {
    if (!supabase) return;
    setError("");
    setNotice("");
    const { error: updateError } = await supabase
      .from("marketplace_kits")
      .update({ is_active: !kit.is_active, updated_at: new Date().toISOString() })
      .eq("id", kit.id);
    if (updateError) {
      setError(`Não foi possível atualizar o kit: ${updateError.message}`);
      return;
    }
    setNotice(kit.is_active ? "Kit ocultado da loja." : "Kit publicado na loja.");
    await loadData();
  }

  async function updateOrderStatus(order: MarketplaceOrder, status: MarketplaceOrder["status"]) {
    if (!supabase || status === order.status) return;
    setSavingOrderId(order.id);
    setError("");
    const { error: updateError } = await supabase
      .from("marketplace_orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", order.id);
    setSavingOrderId(null);
    if (updateError) {
      setError(`Não foi possível atualizar o pedido: ${updateError.message}`);
      return;
    }
    setNotice(`Pedido ${order.id.slice(0, 8).toUpperCase()} atualizado.`);
    await loadData();
  }

  function updateCostForm<K extends keyof CostForm>(key: K, value: CostForm[K]) {
    setCostForm((current) => ({ ...current, [key]: value }));
  }

  async function saveCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    setNotice("");
    const quantity = Number(costForm.quantity.replace(",", "."));
    const totalCost = Number(costForm.totalCost.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(totalCost) || totalCost < 0) {
      setError("Informe uma quantidade maior que zero e um valor total válido.");
      return;
    }

    setSaving(true);
    const { data, error: insertError } = await supabase.rpc("admin_record_purchase_cost", {
      p_item_name: costForm.itemName.trim(),
      p_quantity: quantity,
      p_unit: costForm.unit.trim(),
      p_total_cost: totalCost,
      p_purchased_on: costForm.purchasedOn,
      p_notes: costForm.notes.trim(),
    });
    setSaving(false);
    if (insertError) {
      setError(`Não foi possível registrar a compra: ${insertError.message}`);
      return;
    }
    if (!isCostComparison(data)) {
      setError("A compra foi registrada, mas não conseguimos ler a comparação de preços.");
      return;
    }

    setCostForm(emptyCostForm());
    setCostComparison(data);
    await loadData();
  }

  function updateAnnouncementForm<K extends keyof AnnouncementForm>(
    key: K,
    value: AnnouncementForm[K],
  ) {
    setAnnouncementForm((current) => ({ ...current, [key]: value }));
  }

  async function saveAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setAnnouncementError("");

    const message = announcementForm.message.trim();
    const hasPrice = announcementForm.price.trim() !== "";
    const price = hasPrice ? Number(announcementForm.price.replace(",", ".")) : null;
    if (message.length < 3 || message.length > 180) {
      setAnnouncementError("Escreva um recado de 3 a 180 caracteres.");
      return;
    }
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setAnnouncementError("Informe um preço válido ou deixe o campo em branco.");
      return;
    }

    setAnnouncementSaving(true);
    const { error: insertError } = await supabase
      .from("marketplace_announcements")
      .insert({
        message,
        price,
        unit: announcementForm.unit.trim(),
        is_active: true,
      });
    setAnnouncementSaving(false);
    if (insertError) {
      setAnnouncementError(`Não foi possível publicar o recado: ${insertError.message}`);
      return;
    }

    setAnnouncementForm(emptyAnnouncementForm());
    setNotice("Recado da feira publicado na loja.");
    setAnnouncementReload((current) => current + 1);
  }

  async function toggleAnnouncement(announcement: StoreAnnouncement) {
    if (!supabase) return;
    setAnnouncementError("");
    const { error: updateError } = await supabase
      .from("marketplace_announcements")
      .update({ is_active: !announcement.is_active, updated_at: new Date().toISOString() })
      .eq("id", announcement.id);
    if (updateError) {
      setAnnouncementError(`Não foi possível atualizar o recado: ${updateError.message}`);
      return;
    }
    setNotice(announcement.is_active ? "Recado ocultado da loja." : "Recado publicado na loja.");
    setAnnouncementReload((current) => current + 1);
  }

  const costChange = costComparison?.difference ?? null;
  const costAlertType =
    costChange === null ? "first" : costChange > 0 ? "increase" : costChange < 0 ? "saving" : "same";

  return (
    <section className={compact ? "marketplace-admin marketplace-admin-compact" : "marketplace-admin"}>
      {!compact && isProductEditorOpen && (
        <div className="marketplace-product-page-heading">
          <button className="marketplace-product-back" type="button" onClick={cancelKitEdit}>
            <ArrowLeft size={16} /> Voltar aos produtos
          </button>
          <div>
            <span className="admin-kicker">{editingKitId ? "EDIÇÃO DE PRODUTO" : "NOVO CADASTRO"}</span>
            <h1>{editingKitId ? "Editar produto" : "Cadastrar produto ou kit"}</h1>
            <p>Preencha as informações que seus clientes verão na loja.</p>
          </div>
        </div>
      )}

      {!compact && !isProductEditorOpen && (
        <div className="admin-page-heading">
          <div>
            <span className="admin-kicker">LOJA E OPERAÇÃO</span>
            <h1>Marketplace Kit Feira</h1>
            <p>Cadastre produtos e kits, acompanhe pedidos e compare os preços de compra dos insumos.</p>
          </div>
          {section === "kits" && (
            <button
              className="button button-dark"
              type="button"
              onClick={startNewProduct}
            >
              <Plus size={16} /> Novo produto
            </button>
          )}
        </div>
      )}

      {!compact && !isProductEditorOpen && (
        <div className="marketplace-admin-tabs" role="tablist" aria-label="Seções da loja">
          {([
            ["overview", "Visão geral"],
            ["kits", "Produtos"],
            ["orders", "Pedidos"],
            ["customers", "Clientes"],
            ["announcements", "Recados da feira"],
            ["costs", "Custos de compra"],
          ] as const).map(([id, label]) => (
            <button
              className={section === id ? "marketplace-admin-tab selected" : "marketplace-admin-tab"}
              type="button"
              role="tab"
              aria-selected={section === id}
              key={id}
              onClick={() => {
                setSection(id);
                setError("");
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="marketplace-admin-error" role="alert"><CircleAlert size={15} /> {error}</div>}
      {notice && <div className="marketplace-admin-success" role="status">{notice}</div>}
      {loading && <div className="admin-loading-inline"><LoaderCircle className="spin" size={17} /> Carregando dados da loja...</div>}

      {(compact || section === "overview") && (
        <div>
          <div className="marketplace-admin-stats">
            <article className="marketplace-admin-stat" style={{ animationDelay: "0ms" }}>
              <i><ShoppingBag size={16} /></i><small>ITENS PUBLICADOS</small>
              <strong>{summary?.active_kits ?? 0}</strong><span>disponíveis na loja</span>
            </article>
            <article className="marketplace-admin-stat" style={{ animationDelay: "60ms" }}>
              <i><ReceiptText size={16} /></i><small>PEDIDOS RECEBIDOS</small>
              <strong>{summary?.total_orders ?? 0}</strong><span>{summary?.today_orders ?? 0} recebidos hoje</span>
            </article>
            <article className="marketplace-admin-stat" style={{ animationDelay: "120ms" }}>
              <i><CircleAlert size={16} /></i><small>AGUARDANDO CONTATO</small>
              <strong>{summary?.pending_orders ?? 0}</strong><span>pedidos aguardando WhatsApp</span>
            </article>
            <article className="marketplace-admin-stat" style={{ animationDelay: "180ms" }}>
              <i><Check size={16} /></i><small>VALOR EM PEDIDOS</small>
              <strong>{currency(summary?.order_value ?? 0)}</strong><span>pedidos não cancelados</span>
            </article>
          </div>
          <div className="marketplace-admin-toolbar">
            <div><h2>Pedidos recentes</h2><p>Os pedidos ficam registrados antes da confirmação pelo WhatsApp.</p></div>
            <button
              type="button"
              className="admin-link-button"
              onClick={() => compact ? onOpenStore?.() : setSection("orders")}
            >
              {compact ? "Abrir gestão da loja" : "Ver pedidos"} <ArrowRight size={14} />
            </button>
          </div>
          {recentOrders.length ? (
            <div className="marketplace-admin-table-wrap">
              <table className="marketplace-admin-table">
                <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.id}>
                      <td><strong>#{order.id.slice(0, 8).toUpperCase()}</strong></td>
                      <td>{order.customer_name}</td>
                      <td>{shortDateTime(order.created_at)}</td>
                      <td><strong>{currency(order.total)}</strong></td>
                      <td>{orderStatusLabels[order.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !loading ? (
            <div className="marketplace-admin-empty">Seus primeiros pedidos aparecerão aqui assim que os clientes finalizarem o checkout.</div>
          ) : null}
          {!compact && (
            <div className="marketplace-admin-overview-note">
              <TrendingDown size={16} />
              <span>As compras de frutas e outros insumos são registradas separadamente, sem controle de estoque.</span>
              <button type="button" onClick={() => setSection("costs")}>Registrar custo <ArrowRight size={14} /></button>
            </div>
          )}
        </div>
      )}

      {section === "kits" && (
        <div>
          {isProductEditorOpen ? (
            <form className="marketplace-kit-editor marketplace-product-form" onSubmit={(event) => void saveKit(event)}>
              <div className="marketplace-product-step">
                <span className="marketplace-product-step-label">ETAPA 1 · TIPO DE ITEM</span>
                <h2>O que você vai vender?</h2>
                <p>Escolha um kit pronto ou cadastre um produto para a feira avulsa.</p>
                <div className="marketplace-product-type-choices" role="group" aria-label="Tipo de item">
                  <button
                    className={kitForm.product_type === "kit" ? "marketplace-product-type-button selected" : "marketplace-product-type-button"}
                    type="button"
                    aria-pressed={kitForm.product_type === "kit"}
                    onClick={() => {
                      updateKitForm("product_type", "kit");
                      updateKitForm("sale_unit", "kit");
                    }}
                  >
                    <ShoppingBag size={21} />
                    <span><strong>Kit pronto</strong><small>Um conjunto de produtos com preço fechado.</small></span>
                  </button>
                  <button
                    className={kitForm.product_type === "loose" ? "marketplace-product-type-button selected" : "marketplace-product-type-button"}
                    type="button"
                    aria-pressed={kitForm.product_type === "loose"}
                    onClick={() => {
                      updateKitForm("product_type", "loose");
                      updateKitForm("sale_unit", "kg");
                      updateKitForm("is_featured", false);
                    }}
                  >
                    <Plus size={21} />
                    <span><strong>Produto avulso</strong><small>Um item vendido por quilo, unidade ou pacote.</small></span>
                  </button>
                </div>
              </div>

              <div className="marketplace-product-step">
                <span className="marketplace-product-step-label">ETAPA 2 · INFORMAÇÕES</span>
                <h2>Conte os detalhes</h2>
                <p>Essas informações ajudam o cliente a escolher o que levar.</p>
                <div className="marketplace-kit-fields">
                  <label className="marketplace-kit-field">
                    {kitForm.product_type === "kit" ? "Nome do kit *" : "Nome do produto *"}
                    <input value={kitForm.name} onChange={(event) => updateKitForm("name", event.target.value)} maxLength={120} placeholder={kitForm.product_type === "kit" ? "Ex.: Kit Tropical" : "Ex.: Banana prata"} required />
                  </label>
                  <label className="marketplace-kit-field">
                    {kitForm.product_type === "kit" ? "Preço do kit (R$) *" : `Preço por ${kitForm.sale_unit} (R$) *`}
                    <input type="number" min="0" step="0.01" value={kitForm.price} onChange={(event) => updateKitForm("price", event.target.value)} placeholder="0,00" required />
                    {kitForm.product_type === "loose" && <small className="marketplace-product-field-help">O preço será calculado pela quantidade escolhida pelo cliente.</small>}
                  </label>
                  <label className="marketplace-kit-field full">
                    Descrição *
                    <textarea value={kitForm.description} onChange={(event) => updateKitForm("description", event.target.value)} maxLength={700} placeholder={kitForm.product_type === "kit" ? "Conte o que torna este kit especial." : "Descreva este produto."} required />
                  </label>
                  {kitForm.product_type === "kit" ? (
                    <label className="marketplace-kit-field full">
                      O que vem no kit
                      <textarea value={kitForm.contents} onChange={(event) => updateKitForm("contents", event.target.value)} maxLength={700} placeholder="Ex.: banana, laranja, maçã e frutas da estação." />
                    </label>
                  ) : (
                    <label className="marketplace-kit-field">
                      Unidade de venda *
                      <select value={kitForm.sale_unit} onChange={(event) => updateKitForm("sale_unit", event.target.value)}>
                        <option value="kg">Quilo (kg)</option>
                        <option value="unidade">Unidade</option>
                        <option value="dúzia">Dúzia</option>
                        <option value="bandeja">Bandeja</option>
                        <option value="maço">Maço</option>
                      </select>
                    </label>
                  )}
                  <div className="marketplace-kit-field full">
                    Foto do produto <span className="marketplace-product-optional">(opcional)</span>
                    <label className="marketplace-kit-image">
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setKitImage(event.target.files?.[0] ?? null)} />
                      {kitImage ? (
                        <><ImagePlus size={20} /><span><strong>{kitImage.name}</strong><small>Clique para escolher outra foto</small></span></>
                      ) : editingKitId && kits.find((kit) => kit.id === editingKitId)?.image_url ? (
                        <><img src={kits.find((kit) => kit.id === editingKitId)?.image_url ?? ""} alt="" /><span><strong>Foto atual</strong><small>Clique para trocar · JPG, PNG ou WEBP até 5 MB</small></span></>
                      ) : (
                        <><ImagePlus size={20} /><span><strong>Adicionar foto</strong><small>JPG, PNG ou WEBP · até 5 MB</small></span></>
                      )}
                    </label>
                  </div>
                </div>
              </div>

              <details className="marketplace-product-advanced">
                <summary>Opções avançadas</summary>
                <label className="marketplace-kit-field">
                  Ordem de exibição
                  <input type="number" step="1" value={kitForm.display_order} onChange={(event) => updateKitForm("display_order", event.target.value)} />
                </label>
              </details>

              <div className="marketplace-product-publish">
                <div><strong>Disponibilidade na loja</strong><small>Você pode ocultar este item sem perder o histórico de pedidos.</small></div>
                <label><input type="checkbox" checked={kitForm.is_active} onChange={(event) => updateKitForm("is_active", event.target.checked)} /> Publicar na loja</label>
                {kitForm.product_type === "kit" && <label><input type="checkbox" checked={kitForm.is_featured} onChange={(event) => updateKitForm("is_featured", event.target.checked)} /> Destacar como mais pedido</label>}
              </div>

              <div className="marketplace-kit-editor-actions">
                <button className="admin-secondary-button" type="button" onClick={cancelKitEdit}>Cancelar</button>
                <button className="button button-dark" type="submit" disabled={saving}>
                  {saving ? <><LoaderCircle className="spin" size={15} /> Salvando...</> : <>{editingKitId ? "Salvar alterações" : "Publicar produto"} <ArrowRight size={15} /></>}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="marketplace-admin-toolbar">
                <div><h2>Produtos e kits cadastrados</h2><p>Ocultar um produto mantém seu histórico de pedidos.</p></div>
              </div>
              {kits.length ? (
                <div className="marketplace-admin-table-wrap">
                  <table className="marketplace-admin-table">
                    <thead><tr><th>Produto</th><th>Tipo</th><th>Valor</th><th>Ordem</th><th>Status</th><th>Ações</th></tr></thead>
                    <tbody>
                      {kits.map((kit) => (
                        <tr key={kit.id}>
                          <td>
                            {kit.image_url && <img src={kit.image_url} alt="" />}
                            <strong>{kit.name}</strong>
                            {kit.is_featured && <small>Em destaque</small>}
                          </td>
                          <td>{kit.product_type === "kit" ? "Kit pronto" : `Avulso · ${kit.sale_unit}`}</td>
                          <td>{currency(kit.price)}{kit.product_type === "loose" ? ` / ${kit.sale_unit}` : ""}</td>
                          <td>{kit.display_order}</td>
                          <td>{kit.is_active ? "Publicado" : "Oculto"}</td>
                          <td>
                            <button className="icon-button" type="button" onClick={() => editKit(kit)} aria-label={`Editar ${kit.name}`}><Pencil size={14} /></button>
                            <button className="admin-secondary-button" type="button" onClick={() => void toggleKit(kit)}>{kit.is_active ? "Ocultar" : "Publicar"}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : !loading ? (
                <div className="marketplace-admin-empty marketplace-product-empty">
                  <span>Seus produtos e kits aparecerão aqui após o cadastro.</span>
                  <button className="button button-dark" type="button" onClick={startNewProduct}><Plus size={15} /> Cadastrar o primeiro item</button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {section === "orders" && (
        <div>
          <div className="marketplace-admin-toolbar">
            <div><h2>Pedidos da loja</h2><p>O pedido é registrado no checkout e confirmado pelo WhatsApp.</p></div>
          </div>
          {orders.length ? (
            <div className="marketplace-admin-table-wrap">
              <table className="marketplace-admin-table">
                <thead><tr><th>Pedido / itens</th><th>Cliente / entrega</th><th>Pagamento</th><th>Data</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>#{order.id.slice(0, 8).toUpperCase()}</strong>
                        <small>{order.items.map((item) => `${formatQuantity(item.quantity)} ${item.unit_label} · ${item.kit_name}`).join(", ")}</small>
                      </td>
                      <td>
                        <strong>{order.customer_name}</strong>
                        <small>{order.phone}</small>
                        <details className="marketplace-order-details">
                          <summary>Ver endereço</summary>
                          <span>{order.delivery_address}, {order.address_number}</span>
                          {order.complement && <span>{order.complement}</span>}
                          <span>{order.neighborhood} · {order.city}{order.postal_code ? ` · CEP ${order.postal_code}` : ""}</span>
                        </details>
                      </td>
                      <td>{paymentLabels[order.payment_method] ?? order.payment_method}</td>
                      <td>{shortDateTime(order.created_at)}</td>
                      <td><strong>{currency(order.total)}</strong></td>
                      <td>
                        <select
                          value={order.status}
                          disabled={savingOrderId === order.id}
                          onChange={(event) => void updateOrderStatus(order, event.target.value as MarketplaceOrder["status"])}
                          aria-label={`Status do pedido ${order.id.slice(0, 8)}`}
                        >
                          {orderStatuses.map((status) => <option value={status} key={status}>{orderStatusLabels[status]}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !loading ? (
            <div className="marketplace-admin-empty">Nenhum pedido recebido ainda. Os novos pedidos aparecerão aqui.</div>
          ) : null}
        </div>
      )}

      {section === "customers" && (
        <div>
          <div className="marketplace-admin-toolbar">
            <div><h2>Clientes Kit Feira</h2><p>Contas cadastradas, contato e histórico de compras.</p></div>
            <button type="button" className="admin-link-button" onClick={() => setCustomerReload((current) => current + 1)}>
              Atualizar lista <ArrowRight size={14} />
            </button>
          </div>
          <div className="customer-crm-stats">
            <article><Users size={17} /><span>Clientes cadastrados</span><strong>{customers.length}</strong></article>
            <article><ReceiptText size={17} /><span>Pedidos vinculados</span><strong>{customers.reduce((total, customer) => total + customer.order_count, 0)}</strong></article>
            <article><TrendingUp size={17} /><span>Valor não cancelado</span><strong>{currency(customers.reduce((total, customer) => total + customer.purchase_total, 0))}</strong></article>
          </div>
          <label className="customer-crm-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone"
              aria-label="Buscar clientes"
            />
          </label>
          {customersError && <div className="marketplace-admin-error"><CircleAlert size={15} /> {customersError}</div>}
          {customersLoading ? (
            <div className="admin-loading-inline"><LoaderCircle className="spin" size={17} /> Carregando clientes...</div>
          ) : visibleCustomers.length ? (
            <div className="marketplace-admin-table-wrap">
              <table className="marketplace-admin-table customer-crm-table">
                <thead><tr><th>Cliente</th><th>Contato</th><th>Cadastro</th><th>Pedidos</th><th>Total não cancelado</th><th>Último pedido</th></tr></thead>
                <tbody>
                  {visibleCustomers.map((customer) => (
                    <tr key={customer.user_id}>
                      <td><strong>{customer.full_name || "Cliente Kit Feira"}</strong></td>
                      <td>
                        <a href={`mailto:${customer.email}`}>{customer.email}</a>
                        {customer.phone && (
                          <a className="customer-crm-whatsapp" href={`https://wa.me/${phoneDigits(customer.phone)}`} target="_blank" rel="noreferrer">
                            WhatsApp · {customer.phone}
                          </a>
                        )}
                      </td>
                      <td>{shortDateTime(customer.created_at)}</td>
                      <td><strong>{customer.order_count}</strong></td>
                      <td><strong>{currency(customer.purchase_total)}</strong></td>
                      <td>{customer.last_order_at ? shortDateTime(customer.last_order_at) : "Ainda sem pedidos"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="marketplace-admin-empty">
              {customerSearch.trim()
                ? `Nenhum cliente encontrado para "${customerSearch.trim()}".`
                : "Os clientes que criarem uma conta aparecerão aqui, junto ao histórico de compras."}
            </div>
          )}
        </div>
      )}

      {section === "announcements" && (
        <div>
          <div className="marketplace-admin-toolbar">
            <div>
              <h2>Recados da feira</h2>
              <p>Crie chamadas de preço e novidades que aparecem animadas na loja.</p>
            </div>
          </div>
          <form className="marketplace-announcement-form" onSubmit={(event) => void saveAnnouncement(event)}>
            <div className="marketplace-announcement-form-heading">
              <i><Megaphone size={17} /></i>
              <div><strong>Novo recado</strong><small>Ex.: “Olha a laranja!” ou “Caiu, caiu o preço da maçã!”</small></div>
            </div>
            <div className="marketplace-announcement-fields">
              <label>
                Frase da feira *
                <input
                  value={announcementForm.message}
                  onChange={(event) => updateAnnouncementForm("message", event.target.value)}
                  maxLength={180}
                  placeholder="Caiu, caiu o preço da maçã!"
                  required
                />
              </label>
              <label>
                Preço (opcional)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={announcementForm.price}
                  onChange={(event) => updateAnnouncementForm("price", event.target.value)}
                  placeholder="0,00"
                />
              </label>
              <label>
                Unidade
                <input
                  value={announcementForm.unit}
                  onChange={(event) => updateAnnouncementForm("unit", event.target.value)}
                  maxLength={24}
                  placeholder="kg, unidade..."
                />
              </label>
            </div>
            <div className="marketplace-announcement-preview" aria-live="polite">
              <span>PRÉVIA NA LOJA</span>
              <strong>{announcementForm.message.trim() || "Olha a laranja!"}</strong>
              {announcementForm.price.trim() && Number.isFinite(Number(announcementForm.price)) && Number(announcementForm.price) >= 0 && (
                <b>{currency(Number(announcementForm.price))}{announcementForm.unit.trim() ? ` / ${announcementForm.unit.trim()}` : ""}</b>
              )}
            </div>
            {announcementError && <div className="marketplace-admin-error" role="alert"><CircleAlert size={15} /> {announcementError}</div>}
            <button className="button button-dark marketplace-announcement-submit" type="submit" disabled={announcementSaving}>
              {announcementSaving ? <><LoaderCircle className="spin" size={15} /> Publicando...</> : <>Publicar recado <ArrowRight size={15} /></>}
            </button>
          </form>

          <div className="marketplace-admin-toolbar">
            <div><h2>Recados cadastrados</h2><p>Recados ativos aparecem no canto da tela da loja; os ocultos ficam guardados aqui.</p></div>
            <button type="button" className="admin-link-button" onClick={() => setAnnouncementReload((current) => current + 1)}>
              Atualizar lista <ArrowRight size={14} />
            </button>
          </div>
          {announcementLoading ? (
            <div className="admin-loading-inline"><LoaderCircle className="spin" size={17} /> Carregando recados...</div>
          ) : announcements.length ? (
            <div className="marketplace-announcement-list">
              {announcements.map((announcement) => (
                <article className={announcement.is_active ? "marketplace-announcement-row active" : "marketplace-announcement-row"} key={announcement.id}>
                  <i><Megaphone size={16} /></i>
                  <div>
                    <strong>{announcement.message}</strong>
                    {announcement.price !== null && <small>{currency(announcement.price)}{announcement.unit ? ` / ${announcement.unit}` : ""}</small>}
                  </div>
                  <span className="marketplace-announcement-status">{announcement.is_active ? "Publicado" : "Oculto"}</span>
                  <button type="button" className="admin-secondary-button" onClick={() => void toggleAnnouncement(announcement)}>
                    {announcement.is_active ? "Ocultar" : "Publicar"}
                  </button>
                </article>
              ))}
            </div>
          ) : !announcementError ? (
            <div className="marketplace-admin-empty">Seus recados de preço e novidades aparecerão aqui depois de publicados.</div>
          ) : null}
        </div>
      )}

      {section === "costs" && (
        <div>
          <div className="marketplace-admin-stats">
            <article className="marketplace-admin-stat">
              <i><ReceiptText size={16} /></i><small>COMPRAS REGISTRADAS</small>
              <strong>{costs.length}</strong><span>últimos registros</span>
            </article>
            <article className="marketplace-admin-stat">
              <i><TrendingDown size={16} /></i><small>TOTAL REGISTRADO</small>
              <strong>{currency(summary?.total_purchase_cost ?? 0)}</strong><span>todos os custos de compra</span>
            </article>
          </div>
          <form className="market-cost-form" onSubmit={(event) => void saveCost(event)}>
            <h2>Registrar compra de insumos</h2>
            <p>Informe quantidade, unidade e valor total. O sistema compara automaticamente o preço por unidade com o registro anterior do mesmo item.</p>
            <div className="market-cost-fields">
              <label className="market-cost-field">
                Produto / insumo *
                <input value={costForm.itemName} onChange={(event) => updateCostForm("itemName", event.target.value)} maxLength={120} placeholder="Ex.: Laranja" required />
              </label>
              <label className="market-cost-field">
                Quantidade *
                <input type="number" min="0.001" step="0.001" value={costForm.quantity} onChange={(event) => updateCostForm("quantity", event.target.value)} required />
              </label>
              <label className="market-cost-field">
                Unidade *
                <input value={costForm.unit} onChange={(event) => updateCostForm("unit", event.target.value)} maxLength={24} placeholder="kg, caixa, unidade..." required />
              </label>
              <label className="market-cost-field">
                Total pago (R$) *
                <input type="number" min="0" step="0.01" value={costForm.totalCost} onChange={(event) => updateCostForm("totalCost", event.target.value)} required />
              </label>
              <label className="market-cost-field">
                Data da compra *
                <input type="date" value={costForm.purchasedOn} onChange={(event) => updateCostForm("purchasedOn", event.target.value)} required />
              </label>
              <label className="market-cost-field full">
                Observação (opcional)
                <input value={costForm.notes} onChange={(event) => updateCostForm("notes", event.target.value)} maxLength={500} placeholder="Fornecedor, qualidade, feira..." />
              </label>
            </div>
            <div className="market-cost-submit">
              <button className="button button-dark" type="submit" disabled={saving}>
                {saving ? <><LoaderCircle className="spin" size={15} /> Registrando...</> : <>Registrar e comparar <ArrowRight size={15} /></>}
              </button>
            </div>
          </form>

          <div className="marketplace-admin-toolbar">
            <div><h2>Histórico de custos</h2><p>Itens iguais são comparados pela unidade registrada.</p></div>
          </div>
          {costs.length ? (
            <div className="marketplace-admin-table-wrap">
              <table className="marketplace-admin-table">
                <thead><tr><th>Data</th><th>Item</th><th>Quantidade</th><th>Total pago</th><th>Preço por unidade</th><th>Observações</th></tr></thead>
                <tbody>
                  {costs.map((cost) => (
                    <tr key={cost.id}>
                      <td>{displayDate(cost.purchased_on)}</td>
                      <td><strong>{cost.item_name}</strong></td>
                      <td>{cost.quantity} {cost.unit}</td>
                      <td>{currency(cost.total_cost)}</td>
                      <td><strong>{currency(cost.unit_cost)} / {cost.unit}</strong></td>
                      <td>{cost.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !loading ? (
            <div className="marketplace-admin-empty">O histórico de custos aparecerá aqui após o primeiro registro.</div>
          ) : null}
        </div>
      )}

      {costComparison && (
        <div className="market-cost-modal-backdrop">
          <section
            className={`market-cost-modal ${costAlertType}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cost-comparison-title"
          >
            <span className="market-cost-modal-icon">
              {costAlertType === "increase" ? <TrendingUp size={22} /> : costAlertType === "saving" ? <TrendingDown size={22} /> : costAlertType === "same" ? <ArrowDownRight size={22} /> : <Check size={22} />}
            </span>
            <h2 id="cost-comparison-title">
              {costAlertType === "increase"
                ? "O preço aumentou"
                : costAlertType === "saving"
                  ? "Teve economia"
                  : costAlertType === "same"
                    ? "O preço se manteve"
                    : "Primeiro preço registrado"}
            </h2>
            <p>
              {costAlertType === "first"
                ? `Registramos ${costComparison.item_name}. Na próxima compra da mesma unidade, vamos comparar o valor automaticamente.`
                : `${costComparison.item_name}: ${currency(costComparison.unit_cost)} por ${costComparison.unit}.`}
            </p>
            {costComparison.previous_unit_cost !== null && costComparison.difference !== null && (
              <div className="market-cost-comparison">
                Antes: <strong>{currency(costComparison.previous_unit_cost)} / {costComparison.unit}</strong>
                <br />
                Agora: <strong>{currency(costComparison.unit_cost)} / {costComparison.unit}</strong>
                <br />
                Variação: <strong>{costComparison.difference > 0 ? "+" : ""}{currency(costComparison.difference)} / {costComparison.unit}</strong>
                {costComparison.difference_percent !== null && (
                  <> ({costComparison.difference_percent > 0 ? "+" : ""}{costComparison.difference_percent}%)</>
                )}
              </div>
            )}
            <button type="button" onClick={() => setCostComparison(null)}>Entendi</button>
          </section>
        </div>
      )}
    </section>
  );
}
