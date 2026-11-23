export type FruitKit = {
  id: string;
  name: string;
  label: string;
  description: string;
  fruits: string[];
  raffleTitle: string;
  prize: string;
};

export const fruitKits: FruitKit[] = [
  {
    id: "essencial",
    name: "Kit Essencial",
    label: "O queridinho da feira",
    description: "Os clássicos fresquinhos para deixar a semana mais gostosa.",
    fruits: ["🍌", "🍎", "🍊", "🍐"],
    raffleTitle: "Kit Feira Essencial",
    prize: "Kit de frutas fresquinhas",
  },
  {
    id: "tropical",
    name: "Kit Tropical",
    label: "Um toque de verão",
    description: "Sabores tropicais e cores alegres para compartilhar.",
    fruits: ["🍍", "🥭", "🥥", "🍇"],
    raffleTitle: "Kit Feira Tropical",
    prize: "Kit tropical de frutas",
  },
  {
    id: "familia",
    name: "Kit Família",
    label: "Para dividir com todo mundo",
    description: "Uma seleção generosa para reunir a família em volta da mesa.",
    fruits: ["🍉", "🍓", "🍌", "🍊"],
    raffleTitle: "Kit Feira Família",
    prize: "Cesta família de frutas",
  },
];
