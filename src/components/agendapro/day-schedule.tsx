'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';

import { colorForStatus } from '@/lib/agendapro/status-colors';
import { parseAgendaProTime } from '@/lib/agendapro/time';

export type ScheduleBooking = {
  id: number;
  start: string;
  end: string;
  service: string;
  service_provider_id: number;
  status: string;
  client: { first_name: string; last_name: string | null } | null;
};

/** One open block from GET /service_providers/{id} ("times"). A provider
 *  with a lunch break reports two entries for the same day (e.g.
 *  09:00-13:00 and 14:00-18:00) — there's no separate "break" field, the
 *  gap between entries on the same day IS the break. */
export type ProviderWorkingHours = { day: number; day_name: string; open: string; close: string };

const PX_PER_MINUTE = 1.3;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;
const MIN_GAP_MINUTES = 5;

function clientLabel(client: ScheduleBooking['client']) {
  if (!client) return 'Sin cliente';
  return `${client.first_name} ${client.last_name ?? ''}`.trim();
}

function minutesSinceMidnight(iso: string) {
  const date = parseAgendaProTime(iso);
  return date.getHours() * 60 + date.getMinutes();
}

function normalizeDayName(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function minutesFromClock(value: string) {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

type LaidOutBooking = ScheduleBooking & { col: number; totalCols: number };

/** Side-by-side layout for bookings that overlap in time on the same
 *  provider (e.g. a therapist double- or triple-booked, or several
 *  "stations" under one provider) — without this, overlapping bookings
 *  render stacked on top of each other and all but one become
 *  unreadable/unclickable. Standard day-view packing: group into
 *  disjoint time clusters, then greedily assign each booking the first
 *  column whose last booking already ended. */
function layoutOverlaps(bookings: ScheduleBooking[]): LaidOutBooking[] {
  const sorted = [...bookings].sort((a, b) => minutesSinceMidnight(a.start) - minutesSinceMidnight(b.start));
  const result: LaidOutBooking[] = [];
  let clusterStartIndex = 0;
  let clusterEnd = -Infinity;
  let columnEnds: number[] = [];

  const flushCluster = (endIndexExclusive: number) => {
    const totalCols = columnEnds.length || 1;
    for (let i = clusterStartIndex; i < endIndexExclusive; i++) {
      result[i].totalCols = totalCols;
    }
  };

  sorted.forEach((booking, index) => {
    const start = minutesSinceMidnight(booking.start);
    const end = Math.max(start + 1, minutesSinceMidnight(booking.end));
    if (start >= clusterEnd) {
      // Disjoint from everything so far — close out the previous
      // cluster's column count and start a new one.
      flushCluster(index);
      clusterStartIndex = index;
      columnEnds = [];
    }
    let col = columnEnds.findIndex((endTime) => endTime <= start);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[col] = end;
    }
    clusterEnd = Math.max(clusterEnd, end);
    result.push({ ...booking, col, totalCols: 1 });
  });
  flushCluster(sorted.length);

  return result;
}

/** Gaps in a provider's own working hours for one weekday — rendered as
 *  "Profesional no disponible" (end of shift, or not working that day
 *  at all) and, when two shifts exist for the same day, the midday gap
 *  between them (the lunch break). Matched by day_name (always Spanish
 *  per AgendaPro's docs) rather than the numeric `day`, since its
 *  Sunday/Saturday numbering isn't confirmed anywhere. */
function unavailableRanges(
  times: ProviderWorkingHours[] | undefined,
  weekdayName: string,
  gridStartMinutes: number,
  gridEndMinutes: number,
): { start: number; end: number }[] {
  const todays = (times ?? []).filter((t) => normalizeDayName(t.day_name) === weekdayName);
  const open = todays
    .map((t) => ({ start: minutesFromClock(t.open), end: minutesFromClock(t.close) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  if (open.length === 0) {
    // Not in `times` at all for this weekday — not working, full grid is gray.
    return [{ start: gridStartMinutes, end: gridEndMinutes }];
  }

  const gaps: { start: number; end: number }[] = [];
  let cursor = gridStartMinutes;
  for (const block of open) {
    if (block.start - cursor >= MIN_GAP_MINUTES) gaps.push({ start: cursor, end: Math.min(block.start, gridEndMinutes) });
    cursor = Math.max(cursor, block.end);
  }
  if (gridEndMinutes - cursor >= MIN_GAP_MINUTES) gaps.push({ start: cursor, end: gridEndMinutes });
  return gaps.filter((g) => g.end > g.start);
}

/**
 * Day view with one column per provider and bookings placed at their
 * real time/duration — the AgendaPro-style schedule (vs. a flat list
 * or a month grid). Colors come from colorForStatus; clicking a block
 * opens the caller's popover with the full booking detail. Gray
 * hatched blocks show when a provider isn't working at all that day,
 * after their shift ends, or on a break between two shifts.
 */
export function AgendaProDaySchedule({
  date,
  providers,
  bookings,
  statusColors,
  providerSchedules,
  onSelectBooking,
  selectedBookingId,
}: {
  date: Date;
  providers: { id: number; name: string }[];
  bookings: ScheduleBooking[];
  statusColors: Record<string, string>;
  providerSchedules: Record<number, ProviderWorkingHours[]>;
  onSelectBooking: (booking: ScheduleBooking, element: HTMLElement) => void;
  selectedBookingId: number | null;
}) {
  const weekdayName = useMemo(
    () => normalizeDayName(new Intl.DateTimeFormat('es-MX', { weekday: 'long' }).format(date)),
    [date],
  );

  const { startHour, endHour } = useMemo(() => {
    let minMinute = DEFAULT_START_HOUR * 60;
    let maxMinute = DEFAULT_END_HOUR * 60;
    for (const booking of bookings) {
      minMinute = Math.min(minMinute, minutesSinceMidnight(booking.start));
      maxMinute = Math.max(maxMinute, minutesSinceMidnight(booking.end));
    }
    return { startHour: Math.floor(minMinute / 60), endHour: Math.ceil(maxMinute / 60) };
  }, [bookings]);

  const totalMinutes = (endHour - startHour) * 60;
  const gridHeight = totalMinutes * PX_PER_MINUTE;
  const hours = useMemo(() => {
    const result: number[] = [];
    for (let h = startHour; h <= endHour; h++) result.push(h);
    return result;
  }, [startHour, endHour]);

  const bookingsByProvider = useMemo(() => {
    const map = new Map<number, LaidOutBooking[]>();
    const grouped = new Map<number, ScheduleBooking[]>();
    for (const booking of bookings) {
      const list = grouped.get(booking.service_provider_id) ?? [];
      list.push(booking);
      grouped.set(booking.service_provider_id, list);
    }
    for (const [providerId, list] of grouped) map.set(providerId, layoutOverlaps(list));
    return map;
  }, [bookings]);

  if (providers.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No hay prestadores para mostrar.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="flex min-w-max">
        {/* Time axis */}
        <div className="w-16 shrink-0 border-r bg-muted/30">
          <div className="h-12 border-b" />
          <div style={{ height: gridHeight }} className="relative">
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 w-full -translate-y-1/2 pr-2 text-right text-[11px] text-muted-foreground"
                style={{ top: (hour - startHour) * 60 * PX_PER_MINUTE }}
              >
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}
          </div>
        </div>

        {providers.map((provider) => {
          const gaps = unavailableRanges(providerSchedules[provider.id], weekdayName, startHour * 60, endHour * 60);
          return (
            <div key={provider.id} className="w-48 shrink-0 border-r last:border-r-0">
              <div className="flex h-12 flex-col items-center justify-center border-b bg-muted/30 px-2 text-center">
                <span className="truncate text-xs font-medium text-foreground">{provider.name}</span>
              </div>
              <div className="relative" style={{ height: gridHeight }}>
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-dashed border-border/60"
                    style={{ top: (hour - startHour) * 60 * PX_PER_MINUTE }}
                  />
                ))}

                {gaps.map((gap, index) => (
                  <div
                    key={index}
                    className="absolute inset-x-0 flex items-center justify-center overflow-hidden px-1 text-center text-[10px] font-medium text-muted-foreground"
                    style={{
                      top: (gap.start - startHour * 60) * PX_PER_MINUTE,
                      height: (gap.end - gap.start) * PX_PER_MINUTE,
                      backgroundImage:
                        'repeating-linear-gradient(45deg, var(--muted), var(--muted) 6px, var(--border) 6px, var(--border) 12px)',
                    }}
                  >
                    {(gap.end - gap.start) * PX_PER_MINUTE >= 24 ? 'Profesional no disponible' : null}
                  </div>
                ))}

                {(bookingsByProvider.get(provider.id) ?? []).map((booking) => {
                  const top = (minutesSinceMidnight(booking.start) - startHour * 60) * PX_PER_MINUTE;
                  const height = Math.max(20, (minutesSinceMidnight(booking.end) - minutesSinceMidnight(booking.start)) * PX_PER_MINUTE);
                  const color = colorForStatus(booking.status, statusColors);
                  const widthPct = 100 / booking.totalCols;
                  return (
                    <button
                      key={booking.id}
                      type="button"
                      onClick={(event) => onSelectBooking(booking, event.currentTarget)}
                      className={`absolute overflow-hidden rounded px-1.5 py-1 text-left text-[11px] leading-tight text-white shadow-sm transition-transform hover:z-10 hover:scale-[1.02] ${
                        selectedBookingId === booking.id ? 'ring-2 ring-foreground' : ''
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${booking.col * widthPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                        backgroundColor: color,
                      }}
                    >
                      <div className="truncate font-semibold">{clientLabel(booking.client)}</div>
                      <div className="truncate opacity-90">
                        {format(parseAgendaProTime(booking.start), 'HH:mm')} · {booking.service}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
