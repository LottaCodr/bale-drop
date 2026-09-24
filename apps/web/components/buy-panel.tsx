"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QtyStepper } from "@/components/qty-stepper";
import { AddedToCartNote, AddToCartButton } from "@/components/add-to-cart-button";
import type { Product, Vendor } from "@bale-drop/database";
import { naira } from "@/lib/format";

/**
 * Buy panel for single (non-bale) listings: quantity, add-to-cart and buy-now.
 * Quantity used to be fixed at 1 with no way to buy two of a bundle item; the
 * stepper is client state that feeds the cart store.
 */
export function BuyPanel({ product, vendor }: { product: Product; vendor: Vendor }) {
  const [qty, setQty] = useState(1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tabular-nums">{naira(product.price)}</span>
        {product.oldPrice && (
          <>
            <span className="text-muted-foreground line-through tabular-nums">{naira(product.oldPrice)}</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[13px] font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Save {naira(product.oldPrice - product.price)}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <QtyStepper value={qty} onChange={setQty} label="Quantity" />
        <span className="text-sm text-muted-foreground">
          Total <b className="tabular-nums text-foreground">{naira(product.price * qty)}</b>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <AddToCartButton product={product} vendor={vendor} qty={qty} />
        <Button size="lg" asChild>
          <Link href={`/checkout?product=${encodeURIComponent(product.id)}`}>
            <Zap /> Buy now
          </Link>
        </Button>
      </div>
      <AddedToCartNote product={product} qty={qty} />
    </div>
  );
}
