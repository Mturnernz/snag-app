import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import { AddRow, Group, Row, TextButton, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';
import { formatMoney, inclGst, isUndecided } from '../lib/supabase';
import { formatExactDate, groupBySupplier } from '@snag/supabase-queries';
import type { ProjectExpectedCost, ProjectItem, ProjectQuote, ProjectQuoteRoom } from '../types';
import type { RoomRow } from '../lib/supabase';

interface Props {
  visible: boolean;
  room: RoomRow | null;
  items: ProjectItem[];
  quotes: ProjectQuote[];
  /** Which rooms prices on the whole job are shared with. */
  quoteRooms: ProjectQuoteRoom[];
  expected: ProjectExpectedCost[];
  onClose: () => void;
  onOpenThing: (item: ProjectItem) => void;
  onOpenPrice: (quote: ProjectQuote) => void;
  onOpenExpected: (cost: ProjectExpectedCost) => void;
  onAdd: (room: RoomRow) => void;
  onRemove?: (room: RoomRow) => void;
}

/**
 * Where one room's money is going: the things in it, the prices and bills
 * that belong to the room as a whole, and anything expected there that nobody
 * has priced. "Whole job" is the same sheet for money that belongs to no room —
 * the builder's contract, the architect, the council.
 *
 * A bill on the whole job that is **shared** with this room is listed here too,
 * saying what share of it is this room's — and it stays listed under *Whole
 * job* as well, because that is where the bill itself lives and where the rest
 * of it is counted.
 *
 * **A supplier who has sent more than one is one heading**, with their quotes
 * and bills beneath it in date order — an engineer billing monthly reads as
 * *MSC Consulting Group Ltd · 4 bills* rather than the same name four times.
 * The heading's figure is what the rows under it add up to, and it folds; a
 * supplier with one price is the one row it always was.
 */
export default function RoomSheet({
  visible, room, items, quotes, quoteRooms, expected, onClose, onOpenThing, onOpenPrice, onOpenExpected, onAdd, onRemove,
}: Props) {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  if (!room) return null;

  const toggle = (key: string) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const things = room.elementId ? items.filter((i) => i.elementId === room.elementId) : [];
  const shares = new Map(
    quoteRooms.filter((r) => r.elementId === room.elementId).map((r) => [r.quoteId, r.amount]),
  );
  const prices = quotes.filter((q) =>
    room.elementId ? q.elementId === room.elementId || shares.has(q.id) : q.projectId !== null)
    // A progress bill is shown under the price it is part of, not beside it.
    .filter((q) => q.againstQuoteId === null);
  const expecting = expected.filter((x) =>
    x.settledBy === null && (room.elementId ? x.elementId === room.elementId : x.elementId === null));

  const thingValue = (item: ProjectItem): string | null => {
    if (item.committed !== null) return formatMoney(item.committed);
    const options = quotes.filter((q) => q.itemId === item.id && q.kind === 'quote' && q.status !== 'declined');
    if (options.length === 0) return null;
    const amounts = options.map((q) => q.amountIncl ?? 0);
    const low = Math.min(...amounts);
    const high = Math.max(...amounts);
    return low === high ? formatMoney(low) : `${formatMoney(low)}–${formatMoney(high)}`;
  };

  const shareText = (q: ProjectQuote): string | null => {
    if (!shares.has(q.id)) return null;
    const share = shares.get(q.id);
    return share === null || share === undefined
      ? 'Shared, not split'
      : `Shared · ${formatMoney(inclGst(share, q.amountInclGst))} of it`;
  };

  return (
    <Sheet visible={visible} title={room.name} subtitle={formatMoney(room.total)} onClose={onClose} closeLabel="Done">
      {things.length > 0 ? (
        <View style={groupedStyles.block}>
          <Text style={styles.heading}>Things</Text>
          <Group>
            {things.map((item) => (
              <Row
                key={item.id}
                title={item.name}
                subtitle={
                  item.excluded ? 'Decided against'
                    : isUndecided(item) ? 'To decide'
                      : item.status === 'installed' ? 'Chosen · in' : 'Chosen'
                }
                value={thingValue(item)}
                tone={isUndecided(item) ? 'muted' : 'default'}
                dim={item.excluded}
                onPress={() => onOpenThing(item)}
              />
            ))}
          </Group>
        </View>
      ) : null}

      {prices.length > 0 ? (
        <View style={groupedStyles.block}>
          <Text style={styles.heading}>Quotes and bills</Text>
          <Group>
            {groupBySupplier(prices).flatMap((group) => {
              if (group.rows.length === 1) {
                const q = group.rows[0];
                return [
                  <Row
                    key={q.id}
                    title={q.supplier ?? 'No supplier named'}
                    subtitle={[q.detail, shareText(q), statusText(q)].filter(Boolean).join(' · ')}
                    value={formatMoney(q.amountIncl)}
                    dim={q.status === 'declined'}
                    onPress={() => onOpenPrice(q)}
                  />,
                ];
              }
              const open = !folded.has(group.key);
              const heading = describeSupplierGroup(group.rows);
              const rows = [...group.rows].sort((a, b) => (a.dated ?? '9999').localeCompare(b.dated ?? '9999'));
              return [
                <Row
                  key={group.key}
                  title={group.supplier ?? 'No supplier named'}
                  subtitle={heading.subtitle}
                  value={heading.value}
                  bold
                  expanded={open}
                  onPress={() => toggle(group.key)}
                  accessibilityLabel={`${group.supplier}, ${heading.subtitle}`}
                />,
                ...(open ? rows.map((q) => (
                  <Row
                    key={q.id}
                    indent
                    title={q.detail ?? (q.dated ? formatExactDate(q.dated) : q.kind === 'invoice' ? 'A bill' : 'A quote')}
                    subtitle={[
                      q.detail && q.dated ? formatExactDate(q.dated) : null,
                      shareText(q),
                      statusText(q),
                    ].filter(Boolean).join(' · ')}
                    value={formatMoney(q.amountIncl)}
                    dim={q.status === 'declined'}
                    onPress={() => onOpenPrice(q)}
                    accessibilityLabel={`${group.supplier}, ${q.detail ?? 'price'}${q.dated ? `, ${formatExactDate(q.dated)}` : ''}`}
                  />
                )) : []),
              ];
            })}
          </Group>
        </View>
      ) : null}

      {expecting.length > 0 ? (
        <View style={groupedStyles.block}>
          <Text style={styles.heading}>Expecting</Text>
          <Group>
            {expecting.map((x) => (
              <Row
                key={x.id}
                title={x.name}
                subtitle={[x.likelySupplier, x.confirmed ? 'Agreed' : 'No price yet'].filter(Boolean).join(' · ')}
                value={formatMoney(inclGst(x.amount, x.amountInclGst))}
                tone="muted"
                onPress={() => onOpenExpected(x)}
              />
            ))}
          </Group>
        </View>
      ) : null}

      <AddRow label={room.elementId ? `Add to ${room.name}` : 'Add to the whole job'} onPress={() => onAdd(room)} />

      {onRemove && room.elementId ? (
        <TextButton label={`Take ${room.name} off this job`} tone="danger" onPress={() => onRemove(room)} />
      ) : null}
    </Sheet>
  );
}

function statusText(q: ProjectQuote): string {
  if (q.kind === 'invoice') return (q.unpaid ?? 0) > 0 ? 'To pay' : 'Paid';
  return q.status === 'accepted' ? 'Agreed' : q.status === 'declined' ? 'Turned down' : 'Not agreed yet';
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a supplier's heading says: how many of each, and what is still owed.
 *
 * The figure on the right is only drawn when it is the sum of the rows beneath
 * it, which is when every one of them is a bill. A quote and a bill from one
 * supplier do not add up to anything — the bill may well be a draw on the quote
 * — so a mixed heading says what has been billed in words and leaves the
 * figures on the rows.
 */
export function describeSupplierGroup(rows: ProjectQuote[]): { subtitle: string; value: string | null } {
  const bills = rows.filter((q) => q.kind === 'invoice');
  const quotes = rows.filter((q) => q.kind !== 'invoice');
  const billed = bills.reduce((total, q) => total + (q.amountIncl ?? 0), 0);
  const toPay = bills.reduce((total, q) => total + (q.unpaid ?? 0), 0);
  const parts = [
    quotes.length > 0 ? count(quotes.length, 'quote', 'quotes') : null,
    bills.length > 0 ? count(bills.length, 'bill', 'bills') : null,
    bills.length > 0 && quotes.length > 0 ? `${formatMoney(billed)} billed` : null,
    bills.length === 0 ? null : toPay > 0 ? `${formatMoney(toPay)} to pay` : 'Paid',
  ];
  return {
    subtitle: parts.filter(Boolean).join(' · '),
    value: quotes.length === 0 ? formatMoney(billed) : null,
  };
}

const styles = StyleSheet.create({
  heading: {
    fontSize: Typography.title3, fontWeight: Typography.semibold, color: Colors.textPrimary,
    letterSpacing: -0.3, paddingHorizontal: 4, marginBottom: Spacing.xs,
  },
});
