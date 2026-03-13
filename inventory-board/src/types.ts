export type Id = string;

export type Location = {
  id: Id;
  name: string;
  createdAt: string;
};

export type ItemCard = {
  id: Id;
  label: string;
  qty: number;
  color: string;
  createdAt: string;
};

export type LocationState = {
  locations: Location[];
  // locationId -> ordered item ids
  locationItemIds: Record<Id, Id[]>;
  // itemId -> item
  itemsById: Record<Id, ItemCard>;
  // locationId -> group key (optional override)
  locationGroupById?: Record<Id, string>;
  // work order id -> status
  woById?: Record<
    string,
    {
      id: string;
      status: 'incoming' | 'inProduction' | 'finished' | 'shipping' | 'archived';
      createdAt: string;
      // Optional recipe: what this WO is expected to use (does NOT move stock)
      // required: planned qty, filled: how much we already allocated/matched
      requirements?: Array<{ label: string; required: number; filled: number }>;
      // Current stage location for the WO card
      locationId?: Id;
    }
  >;
};

export type Movement = {
  id: Id;
  ts: string;
  fromLocationId: Id;
  fromLocationName: string;
  toLocationId: Id;
  toLocationName: string;
  itemId: Id;
  itemLabel: string;
  qty: number;
};

export type RemotePayload = {
  v: 1;
  state: LocationState;
  movements: Movement[];
};

