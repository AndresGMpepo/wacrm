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

const PX_PER_MINUTE = 1.3;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;

function clientLabel(client: ScheduleBooking['client']) {
  if (!client) return 'Sin cliente';
  return `${client.first_name} ${client.last_name ?? ''}`.trim();
}

function minutesSinceMidnight(iso: string) {
  const date = parseAgendaProTime(iso);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Day view with one column per provider and bookings placed at their
 * real time/duration — the AgendaPro-style schedule (vs. a flat list
 * or a month grid). Colors come from colorForStatus; clicking a block
 * opens the caller's popover with the full booking detail.
 */
export function AgendaProDaySchedule({
  providers,
  bookings,
  statusColors,
  onSelectBooking,
  selectedBookingId,
}: {
  providers: { id: number; name: string }[];
  bookings: ScheduleBooking[];
  statusColors: Record<string, string>;
  onSelectBooking: (booking: ScheduleBooking, element: HTMLElement) => void;
  selectedBookingId: number | null;
}) {
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
    const map = new Map<number, ScheduleBooking[]>();
    for (const booking of bookings) {
      const list = map.get(booking.service_provider_id) ?? [];
      list.push(booking);
      map.set(booking.service_provider_id, list);
    }
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

        {providers.map((provider) => (
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
              {(bookingsByProvider.get(provider.id) ?? []).map((booking) => {
                const top = (minutesSinceMidnight(booking.start) - startHour * 60) * PX_PER_MINUTE;
                const height = Math.max(20, (minutesSinceMidnight(booking.end) - minutesSinceMidnight(booking.start)) * PX_PER_MINUTE);
                const color = colorForStatus(booking.status, statusColors);
                return (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={(event) => onSelectBooking(booking, event.currentTarget)}
                    className={`absolute left-0.5 right-0.5 overflow-hidden rounded px-1.5 py-1 text-left text-[11px] leading-tight text-white shadow-sm transition-transform hover:z-10 hover:scale-[1.02] ${
                      selectedBookingId === booking.id ? 'ring-2 ring-foreground' : ''
                    }`}
                    style={{ top, height, backgroundColor: color }}
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
        ))}
      </div>
    </div>
  );
}
