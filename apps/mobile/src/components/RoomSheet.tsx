import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import { AddRow, Group, Row, TextButton, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';
import { formatMoney, inclGst, isUndecided } from '../lib/supabase';
import type { ProjectExpectedCost, ProjectItem, ProjectQuote } from '../types';
import type { RoomRow } from '../lib/supabase';

interface Props {
  visible: boolean;
  room: RoomRow | null;
  items: ProjectItem[];
  quotes: ProjectQuote[];
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
 */
export default function RoomSheet({
  visible, room, items, quotes, expected, onClose, onOpenThing, onOpenPrice, onOpenExpected, onAdd, onRemove,
}: Props) {
  if (!room) return null;

  const things = room.elementId ? items.filter((i) => i.elementId === room.elementId) : [];
  const prices = quotes.filter((q) =>
    room.elementId ? q.elementId === room.elementId : q.projectId !== null)
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
            {prices.map((q) => (
              <Row
                key={q.id}
                title={q.supplier ?? 'No supplier named'}
                subtitle={[
                  q.detail,
                  q.kind === 'invoice'
                    ? (q.unpaid ?? 0) > 0 ? 'To pay' : 'Paid'
                    : q.status === 'accepted' ? 'Agreed' : q.status === 'declined' ? 'Turned down' : 'Not agreed yet',
                ].filter(Boolean).join(' · ')}
                value={formatMoney(q.amountIncl)}
                dim={q.status === 'declined'}
                onPress={() => onOpenPrice(q)}
              />
            ))}
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

const styles = StyleSheet.create({
  heading: {
    fontSize: Typography.title3, fontWeight: Typography.semibold, color: Colors.textPrimary,
    letterSpacing: -0.3, paddingHorizontal: 4, marginBottom: Spacing.xs,
  },
});
