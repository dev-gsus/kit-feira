export type CepAddress = {
  street: string;
  neighborhood: string;
  city: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function lookupCep(postalCode: string): Promise<CepAddress | null> {
  const cep = postalCode.replace(/\D/g, "");
  if (cep.length !== 8) return null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("A consulta do CEP demorou demais. Tente novamente ou preencha o endereço manualmente.");
    }
    throw new Error("Não foi possível consultar o CEP agora. Tente novamente ou preencha manualmente.");
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error("Não foi possível consultar o CEP agora.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("A consulta do CEP retornou uma resposta inválida.");
  }
  if (!isRecord(payload)) {
    throw new Error("A consulta do CEP retornou uma resposta inválida.");
  }
  if (payload.erro === true) return null;

  const address = {
    street: stringField(payload, "logradouro"),
    neighborhood: stringField(payload, "bairro"),
    city: stringField(payload, "localidade"),
  };
  return address.street || address.neighborhood || address.city ? address : null;
}
