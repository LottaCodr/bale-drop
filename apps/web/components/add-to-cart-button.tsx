"use client";

import { useState } from "react";
import { Check, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addToCart } from "@/lib/cart";

export function AddToCartButton({ productId }: { productId: string }) {
  const [added, setAdded] = useState(false);
  return (
    <Button
      variant="outline"
      size="lg"
      onClick={() => {
        addToCart(productId);
        setAdded(true);
        window.setTimeout(() => setAdded(false), 1800);
      }}
    >
      {added ? <Check /> : <ShoppingBag />}
      {added ? "Added" : "Add to cart"}
    </Button>
  );
}
