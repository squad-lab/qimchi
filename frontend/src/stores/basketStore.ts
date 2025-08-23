import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BasketItem } from "../components/Basket";

interface BasketState {
  items: BasketItem[];
  // Actions
  addItem: (item: BasketItem) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
  updateItem: (id: string, updates: Partial<BasketItem>) => void;
  // live-related actions removed
}

export const useBasketStore = create<BasketState>()(
  persist(
    (set) => ({
      items: [],

      addItem: (item: BasketItem) => {
        set((state) => {
          // Check if item already exists
          const existingIndex = state.items.findIndex(
            (existing) => existing.id === item.id
          );

          if (existingIndex >= 0) {
            // Update existing item
            const updatedItems = [...state.items];
            updatedItems[existingIndex] = {
              ...updatedItems[existingIndex],
              ...item,
            };
            return { items: updatedItems };
          } else {
            // Add new item
            return { items: [...state.items, item] };
          }
        });
      },

      removeItem: (id: string) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        }));
      },

      clearAll: () => {
        set({ items: [] });
      },

      updateItem: (id: string, updates: Partial<BasketItem>) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          ),
        }));
      },

      // live-related actions removed
    }),
    {
      name: "basket-storage",
      version: 1,
    }
  )
);
