declare module 'pokersolver' {
  export interface PokersolverCard {
    value: string;
    suit: string;
    rank: number;
    toString(): string;
  }

  export interface PokersolverHand {
    cards: PokersolverCard[];
    name: string;
    descr: string;
    rank: number;
  }

  interface PokersolverModule {
    Hand: {
      solve(cards: string[], game?: string): PokersolverHand;
      winners(hands: PokersolverHand[]): PokersolverHand[];
    };
  }

  const pokersolver: PokersolverModule;
  export default pokersolver;
}
