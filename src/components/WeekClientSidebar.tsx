'use client';

import { useState } from 'react';
import React from 'react';
import { useDraggable } from '@dnd-kit/core';

import { useClients, SavedClient } from '@/lib/hooks/useClients';
import { useAuth } from '@/lib/hooks/useAuth';

function DraggableClient({ client }: { client: SavedClient }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `client-${client.id}`,
    data: { client },
  });

  // When dragging: hide the original in place — DragOverlay is the only visible ghost.
  // Do NOT apply transform here; that would move the original card along with the cursor
  // and cause a doubled/stretched visual behind the overlay.
  const style: React.CSSProperties = isDragging
    ? { opacity: 0, pointerEvents: 'none' }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="group relative p-3 rounded-[14px] bg-white border border-border-light cursor-grab active:cursor-grabbing transition-all duration-200 hover:border-primary/30 hover:shadow-card hover:-translate-y-[2px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-bold text-text-primary leading-tight truncate group-hover:text-primary transition-colors">{client.name}</h4>
          <p className="text-[11px] text-text-secondary mt-1.5 truncate">{client.address}</p>
        </div>
        {client.color && (
          <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 shadow-sm" style={{ backgroundColor: client.color }} />
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-[10px] font-semibold text-text-secondary bg-surface-hover px-2 py-1 rounded-md flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {client.default_duration_minutes}m
        </span>
        <span className="text-[10px] font-semibold text-text-secondary bg-surface-hover px-2 py-1 rounded-md flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          {client.default_staff_count}
        </span>
      </div>
    </div>
  );
}

export default function WeekClientSidebar() {
  const { profile } = useAuth();
  const { clients, loading, searchClients } = useClients(profile?.org_id || null);
  const [search, setSearch] = useState('');

  const filtered = searchClients(search);

  return (
    <div className="w-72 h-full flex flex-col bg-white/80 backdrop-blur-xl rounded-[20px] border border-white/50 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.08)] shrink-0 relative z-10" style={{ overflow: 'visible' }}>
      <div className="p-4 border-b border-border-light/50 bg-white/50 shrink-0">
        <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          Client Roster
        </h2>
        <p className="text-[11px] font-medium text-text-tertiary mt-1 mb-4">Drag clients directly onto a day</p>
        
        <div className="relative group">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-primary transition-colors">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2.5 bg-surface hover:bg-surface-hover border border-border-light focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-xl text-xs font-medium transition-all outline-none"
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2.5 custom-scrollbar bg-surface-elevated/30 rounded-b-[20px]">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center mb-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <p className="text-[13px] font-semibold text-text-secondary">No clients found</p>
            <p className="text-[11px] text-text-tertiary mt-1">Try a different search term</p>
          </div>
        ) : (
          filtered.map(client => (
            <DraggableClient key={client.id} client={client} />
          ))
        )}
      </div>
    </div>
  );
}
