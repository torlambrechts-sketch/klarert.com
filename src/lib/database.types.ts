
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activity_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_kind": string,"at": string,"chain_key": string,"field_id": string | null,"hash": string,"id": number,"item_id": string | null,"new_value": Json | null,"note": string | null,"old_value": Json | null,"org_id": string,"prev_hash": string,"sheet_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_kind": string,"at"?: string,"chain_key": string,"field_id"?: string | null,"hash"?: string,"id"?: never,"item_id"?: string | null,"new_value"?: Json | null,"note"?: string | null,"old_value"?: Json | null,"org_id": string,"prev_hash"?: string,"sheet_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_kind"?: string,"at"?: string,"chain_key"?: string,"field_id"?: string | null,"hash"?: string,"id"?: never,"item_id"?: string | null,"new_value"?: Json | null,"note"?: string | null,"old_value"?: Json | null,"org_id"?: string,"prev_hash"?: string,"sheet_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_log_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"automation_pauses": {
                  Row: {
                    "automation_id": string,"created_at": string,"item_id": string,"org_id": string,"paused_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "automation_id": string,"created_at"?: string,"item_id": string,"org_id": string,"paused_by"?: string | null
                  }
                  Update: {
                    "automation_id"?: string,"created_at"?: string,"item_id"?: string,"org_id"?: string,"paused_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_pauses_automation_id_fkey"
      columns: ["automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_pauses_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_pauses_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_pauses_paused_by_fkey"
      columns: ["paused_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"automation_runs": {
                  Row: {
                    "automation_id": string | null,"chain_id": string,"depth": number,"detail": string,"event": NonNullable<Json>,"finished_at": string | null,"id": number,"item_id": string | null,"org_id": string,"sheet_id": string | null,"started_at": string,"status": string,"steps": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "automation_id"?: string | null,"chain_id": string,"depth"?: number,"detail"?: string,"event": NonNullable<Json>,"finished_at"?: string | null,"id"?: never,"item_id"?: string | null,"org_id": string,"sheet_id"?: string | null,"started_at"?: string,"status": string,"steps"?: NonNullable<Json>
                  }
                  Update: {
                    "automation_id"?: string | null,"chain_id"?: string,"depth"?: number,"detail"?: string,"event"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: never,"item_id"?: string | null,"org_id"?: string,"sheet_id"?: string | null,"started_at"?: string,"status"?: string,"steps"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_runs_automation_id_fkey"
      columns: ["automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_runs_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_runs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_runs_sheet_id_fkey"
      columns: ["sheet_id"]
isOneToOne: false
      referencedRelation: "sheets"
      referencedColumns: ["id"]
    }
                  ]
                },"automations": {
                  Row: {
                    "actions": NonNullable<Json>,"conditions": NonNullable<Json>,"created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"last_run_at": string | null,"locked": boolean,"name": string,"org_id": string,"run_count": number,"sheet_id": string,"source": string,"trigger": NonNullable<Json>,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actions": NonNullable<Json>,"conditions"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"last_run_at"?: string | null,"locked"?: boolean,"name": string,"org_id": string,"run_count"?: number,"sheet_id": string,"source"?: string,"trigger": NonNullable<Json>,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "actions"?: NonNullable<Json>,"conditions"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"last_run_at"?: string | null,"locked"?: boolean,"name"?: string,"org_id"?: string,"run_count"?: number,"sheet_id"?: string,"source"?: string,"trigger"?: NonNullable<Json>,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "automations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automations_sheet_id_fkey"
      columns: ["sheet_id"]
isOneToOne: false
      referencedRelation: "sheets"
      referencedColumns: ["id"]
    }
                  ]
                },"entities": {
                  Row: {
                    "country": string,"id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "country": string,"id"?: string,"name": string,"org_id": string
                  }
                  Update: {
                    "country"?: string,"id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entities_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"fields": {
                  Row: {
                    "archived_at": string | null,"config": NonNullable<Json>,"created_at": string,"description": string | null,"id": string,"key": string,"locked": boolean,"name": string,"org_id": string,"position": string,"required": boolean,"rules": NonNullable<Json>,"sheet_id": string,"type": string,"updated_at": string,"validation": NonNullable<Json>,"visibility": Json | null,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"config"?: NonNullable<Json>,"created_at"?: string,"description"?: string | null,"id"?: string,"key": string,"locked"?: boolean,"name": string,"org_id": string,"position": string,"required"?: boolean,"rules"?: NonNullable<Json>,"sheet_id": string,"type": string,"updated_at"?: string,"validation"?: NonNullable<Json>,"visibility"?: Json | null,"width"?: number | null
                  }
                  Update: {
                    "archived_at"?: string | null,"config"?: NonNullable<Json>,"created_at"?: string,"description"?: string | null,"id"?: string,"key"?: string,"locked"?: boolean,"name"?: string,"org_id"?: string,"position"?: string,"required"?: boolean,"rules"?: NonNullable<Json>,"sheet_id"?: string,"type"?: string,"updated_at"?: string,"validation"?: NonNullable<Json>,"visibility"?: Json | null,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fields_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fields_sheet_id_fkey"
      columns: ["sheet_id"]
isOneToOne: false
      referencedRelation: "sheets"
      referencedColumns: ["id"]
    }
                  ]
                },"files": {
                  Row: {
                    "collected_at": string,"created_at": string,"field_id": string,"filename": string,"id": string,"item_id": string,"mime_type": string,"org_id": string,"replaced_by": string | null,"sha256": string,"size_bytes": number,"source": string,"storage_path": string,"uploaded_by": string | null,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "collected_at"?: string,"created_at"?: string,"field_id": string,"filename": string,"id"?: string,"item_id": string,"mime_type": string,"org_id": string,"replaced_by"?: string | null,"sha256": string,"size_bytes": number,"source"?: string,"storage_path": string,"uploaded_by"?: string | null,"valid_until"?: string | null
                  }
                  Update: {
                    "collected_at"?: string,"created_at"?: string,"field_id"?: string,"filename"?: string,"id"?: string,"item_id"?: string,"mime_type"?: string,"org_id"?: string,"replaced_by"?: string | null,"sha256"?: string,"size_bytes"?: number,"source"?: string,"storage_path"?: string,"uploaded_by"?: string | null,"valid_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "files_field_id_fkey"
      columns: ["field_id"]
isOneToOne: false
      referencedRelation: "fields"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_replaced_by_fkey"
      columns: ["replaced_by"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"folders": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string,"position": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string,"position": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"position"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "folders_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"form_links": {
                  Row: {
                    "created_at": string,"created_by": string | null,"enabled": boolean,"group_id": string | null,"id": string,"org_id": string,"sheet_id": string,"token": string,"view_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"group_id"?: string | null,"id"?: string,"org_id": string,"sheet_id": string,"token"?: string,"view_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"group_id"?: string | null,"id"?: string,"org_id"?: string,"sheet_id"?: string,"token"?: string,"view_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_links_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_links_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_links_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_links_sheet_id_fkey"
      columns: ["sheet_id"]
isOneToOne: false
      referencedRelation: "sheets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_links_view_id_fkey"
      columns: ["view_id"]
isOneToOne: false
      referencedRelation: "views"
      referencedColumns: ["id"]
    }
                  ]
                },"form_rate_limits": {
                  Row: {
                    "hits": number,"ip_hash": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hits"?: number,"ip_hash": string,"window_start": string
                  }
                  Update: {
                    "hits"?: number,"ip_hash"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"groups": {
                  Row: {
                    "color": string,"created_at": string,"id": string,"name": string,"org_id": string,"position": string,"sheet_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"id"?: string,"name": string,"org_id": string,"position": string,"sheet_id": string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"position"?: string,"sheet_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "groups_sheet_id_fkey"
      columns: ["sheet_id"]
isOneToOne: false
      referencedRelation: "sheets"
      referencedColumns: ["id"]
    }
                  ]
                },"invites": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"email": string,"id": string,"invited_by": string | null,"org_id": string,"role": Database["public"]['Enums']["member_role"],"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"email": string,"id"?: string,"invited_by"?: string | null,"org_id": string,"role"?: Database["public"]['Enums']["member_role"],"token"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"email"?: string,"id"?: string,"invited_by"?: string | null,"org_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invites_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invites_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"item_links": {
                  Row: {
                    "created_at": string,"field_id": string,"from_item": string,"id": string,"org_id": string,"position": string,"to_item": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"field_id": string,"from_item": string,"id"?: string,"org_id": string,"position"?: string,"to_item": string
                  }
                  Update: {
                    "created_at"?: string,"field_id"?: string,"from_item"?: string,"id"?: string,"org_id"?: string,"position"?: string,"to_item"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_links_field_id_fkey"
      columns: ["field_id"]
isOneToOne: false
      referencedRelation: "fields"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_links_from_item_fkey"
      columns: ["from_item"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_links_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_links_to_item_fkey"
      columns: ["to_item"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    }
                  ]
                },"item_updates": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"id": string,"item_id": string,"kind": string,"mentions": (string)[],"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"id"?: string,"item_id": string,"kind"?: string,"mentions"?: (string)[],"org_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"id"?: string,"item_id"?: string,"kind"?: string,"mentions"?: (string)[],"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_updates_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_updates_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_updates_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"items": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"display_id": string,"group_id": string,"id": string,"lock_reason": string | null,"locked": boolean,"name": string,"org_id": string,"position": string,"seq": number,"sheet_id": string,"updated_at": string,"updated_by": string | null,"values": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"display_id": string,"group_id": string,"id"?: string,"lock_reason"?: string | null,"locked"?: boolean,"name": string,"org_id": string,"position": string,"seq": number,"sheet_id": string,"updated_at"?: string,"updated_by"?: string | null,"values"?: NonNullable<Json>
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"display_id"?: string,"group_id"?: string,"id"?: string,"lock_reason"?: string | null,"locked"?: boolean,"name"?: string,"org_id"?: string,"position"?: string,"seq"?: number,"sheet_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"values"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_sheet_id_fkey"
      columns: ["sheet_id"]
isOneToOne: false
      referencedRelation: "sheets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"job_roles": {
                  Row: {
                    "id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"name": string,"org_id": string
                  }
                  Update: {
                    "id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_roles_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"job_title": string | null,"org_id": string,"role": Database["public"]['Enums']["member_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"job_title"?: string | null,"org_id": string,"role"?: Database["public"]['Enums']["member_role"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"job_title"?: string | null,"org_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "automation_id": string | null,"body": string,"created_at": string,"done_at": string | null,"id": string,"item_id": string | null,"kind": string,"org_id": string,"read_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "automation_id"?: string | null,"body": string,"created_at"?: string,"done_at"?: string | null,"id"?: string,"item_id"?: string | null,"kind": string,"org_id": string,"read_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "automation_id"?: string | null,"body"?: string,"created_at"?: string,"done_at"?: string | null,"id"?: string,"item_id"?: string | null,"kind"?: string,"org_id"?: string,"read_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_automation_id_fkey"
      columns: ["automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"orgs": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"settings": NonNullable<Json>,"slug": string,"time_zone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"settings"?: NonNullable<Json>,"slug": string,"time_zone"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"settings"?: NonNullable<Json>,"slug"?: string,"time_zone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"outbound_webhooks": {
                  Row: {
                    "attempts": number,"automation_id": string | null,"created_at": string,"id": string,"item_id": string | null,"last_error": string | null,"next_attempt_at": string,"org_id": string,"payload": NonNullable<Json>,"status": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"automation_id"?: string | null,"created_at"?: string,"id"?: string,"item_id"?: string | null,"last_error"?: string | null,"next_attempt_at"?: string,"org_id": string,"payload": NonNullable<Json>,"status"?: string,"url": string
                  }
                  Update: {
                    "attempts"?: number,"automation_id"?: string | null,"created_at"?: string,"id"?: string,"item_id"?: string | null,"last_error"?: string | null,"next_attempt_at"?: string,"org_id"?: string,"payload"?: NonNullable<Json>,"status"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbound_webhooks_automation_id_fkey"
      columns: ["automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbound_webhooks_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbound_webhooks_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "color": string,"created_at": string,"display_name": string,"id": string,"initials": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"display_name": string,"id": string,"initials": string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"display_name"?: string,"id"?: string,"initials"?: string
                  }
                  Relationships: [
                    
                  ]
                },"protected_values": {
                  Row: {
                    "field_id": string,"item_id": string,"org_id": string,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "field_id": string,"item_id": string,"org_id": string,"value": string
                  }
                  Update: {
                    "field_id"?: string,"item_id"?: string,"org_id"?: string,"value"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "protected_values_field_id_fkey"
      columns: ["field_id"]
isOneToOne: false
      referencedRelation: "fields"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "protected_values_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "protected_values_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"scheduler_fired": {
                  Row: {
                    "automation_id": string,"fired_at": string,"item_id": string,"occurrence": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "automation_id": string,"fired_at"?: string,"item_id": string,"occurrence": string,"org_id": string
                  }
                  Update: {
                    "automation_id"?: string,"fired_at"?: string,"item_id"?: string,"occurrence"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scheduler_fired_automation_id_fkey"
      columns: ["automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scheduler_fired_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scheduler_fired_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"sheets": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"folder_id": string | null,"id": string,"id_prefix": string,"is_library": boolean,"item_label": string,"name": string,"next_seq": number,"org_id": string,"position": string,"settings": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"folder_id"?: string | null,"id"?: string,"id_prefix"?: string,"is_library"?: boolean,"item_label"?: string,"name": string,"next_seq"?: number,"org_id": string,"position": string,"settings"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"folder_id"?: string | null,"id"?: string,"id_prefix"?: string,"is_library"?: boolean,"item_label"?: string,"name"?: string,"next_seq"?: number,"org_id"?: string,"position"?: string,"settings"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sheets_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sheets_folder_id_fkey"
      columns: ["folder_id"]
isOneToOne: false
      referencedRelation: "folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sheets_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"sites": {
                  Row: {
                    "entity_id": string,"id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "entity_id": string,"id"?: string,"name": string,"org_id": string
                  }
                  Update: {
                    "entity_id"?: string,"id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sites_entity_id_fkey"
      columns: ["entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sites_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"team_members": {
                  Row: {
                    "org_id": string,"team_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "org_id": string,"team_id": string,"user_id": string
                  }
                  Update: {
                    "org_id"?: string,"team_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_members_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"name": string,"org_id": string
                  }
                  Update: {
                    "id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"views": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"name": string,"org_id": string,"owner_id": string | null,"position": string,"sheet_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"name": string,"org_id": string,"owner_id"?: string | null,"position": string,"sheet_id": string,"type": string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"owner_id"?: string | null,"position"?: string,"sheet_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "views_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "views_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "views_sheet_id_fkey"
      columns: ["sheet_id"]
isOneToOne: false
      referencedRelation: "sheets"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "_create_item":
{ Args: { "p_actor_id": string,"p_actor_kind": string,"p_group": string,"p_name": string,"p_position": string,"p_sheet": string,"p_values": Json }; Returns: {
              "archived_at": string | null,
"created_at": string,
"created_by": string | null,
"display_id": string,
"group_id": string,
"id": string,
"lock_reason": string | null,
"locked": boolean,
"name": string,
"org_id": string,
"position": string,
"seq": number,
"sheet_id": string,
"updated_at": string,
"updated_by": string | null,
"values": NonNullable<Json>
            }
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: true
        isSetofReturn: false
      } },
"_own_recent_update":
{ Args: { "p_update": string }; Returns: {
              "author_id": string | null,
"body": string,
"created_at": string,
"id": string,
"item_id": string,
"kind": string,
"mentions": (string)[],
"org_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "item_updates"
        isOneToOne: true
        isSetofReturn: false
      } },
"accept_invite":
{ Args: { "p_token": string }; Returns: {
              "created_at": string,
"id": string,
"name": string,
"settings": NonNullable<Json>,
"slug": string,
"time_zone": string
            }
                          SetofOptions: {
        from: "*"
        to: "orgs"
        isOneToOne: true
        isSetofReturn: false
      } },
"activity_hash":
{ Args: { "action": string,"actor_id": string,"actor_kind": string,"at": string,"field_id": string,"new_value": Json,"note": string,"old_value": Json,"prev": string }; Returns: string
                           },
"actor_kind_for":
{ Args: { "p_automation": string }; Returns: string
                           },
"add_file":
{ Args: { "p_field": string,"p_file": string,"p_filename": string,"p_item": string,"p_mime": string,"p_path": string,"p_replaces"?: string,"p_sha256": string,"p_size": number }; Returns: {
              "collected_at": string,
"created_at": string,
"field_id": string,
"filename": string,
"id": string,
"item_id": string,
"mime_type": string,
"org_id": string,
"replaced_by": string | null,
"sha256": string,
"size_bytes": number,
"source": string,
"storage_path": string,
"uploaded_by": string | null,
"valid_until": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "files"
        isOneToOne: true
        isSetofReturn: false
      } },
"can_write":
{ Args: { "o": string,"p_automation": string }; Returns: boolean
                           },
"claim_outbound_webhooks":
{ Args: { "p_limit"?: number }; Returns: {
              "attempts": number,
"automation_id": string | null,
"created_at": string,
"id": string,
"item_id": string | null,
"last_error": string | null,
"next_attempt_at": string,
"org_id": string,
"payload": NonNullable<Json>,
"status": string,
"url": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "outbound_webhooks"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_schedule_occurrence":
{ Args: { "p_automation": string,"p_item": string,"p_occurrence": string }; Returns: boolean
                           },
"create_item":
{ Args: { "p_automation"?: string,"p_group": string,"p_name": string,"p_position": string,"p_sheet": string,"p_values"?: Json }; Returns: {
              "archived_at": string | null,
"created_at": string,
"created_by": string | null,
"display_id": string,
"group_id": string,
"id": string,
"lock_reason": string | null,
"locked": boolean,
"name": string,
"org_id": string,
"position": string,
"seq": number,
"sheet_id": string,
"updated_at": string,
"updated_by": string | null,
"values": NonNullable<Json>
            }
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_items":
{ Args: { "p_group": string,"p_note"?: string,"p_rows": Json,"p_sheet": string }; Returns: number
                           },
"create_sheet":
{ Args: { "p": Json }; Returns: string
                           },
"create_workspace":
{ Args: { "p_name": string,"p_slug": string,"p_time_zone"?: string }; Returns: {
              "created_at": string,
"id": string,
"name": string,
"settings": NonNullable<Json>,
"slug": string,
"time_zone": string
            }
                          SetofOptions: {
        from: "*"
        to: "orgs"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_group":
{ Args: { "p_group": string,"p_positions"?: Json,"p_target"?: string }; Returns: number
                           },
"delete_update":
{ Args: { "p_update": string }; Returns: undefined
                           },
"edit_update":
{ Args: { "p_body": string,"p_mentions"?: (string)[],"p_update": string }; Returns: {
              "author_id": string | null,
"body": string,
"created_at": string,
"id": string,
"item_id": string,
"kind": string,
"mentions": (string)[],
"org_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "item_updates"
        isOneToOne: true
        isSetofReturn: false
      } },
"field_types":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"filter_item_ids":
{ Args: { "p_params": Json,"p_sheet": string,"p_where": string }; Returns: (string)[]
                           },
"get_invite":
{ Args: { "p_token": string }; Returns: {
              "accepted": boolean,"email": string,"invited_by_name": string,"org_name": string,"org_slug": string,"role": Database["public"]['Enums']["member_role"]
            }[]
                           },
"get_public_form":
{ Args: { "p_token": string }; Returns: Json
                           },
"has_role":
{ Args: { "o": string,"roles": (Database["public"]['Enums']["member_role"])[] }; Returns: boolean
                           },
"is_admin":
{ Args: { "o": string }; Returns: boolean
                           },
"is_editor":
{ Args: { "o": string }; Returns: boolean
                           },
"is_member":
{ Args: { "o": string }; Returns: boolean
                           },
"items_for_people":
{ Args: { "p_limit"?: number,"p_org": string,"p_people": (string)[] }; Returns: {
              "archived_at": string | null,
"created_at": string,
"created_by": string | null,
"display_id": string,
"group_id": string,
"id": string,
"lock_reason": string | null,
"locked": boolean,
"name": string,
"org_id": string,
"position": string,
"seq": number,
"sheet_id": string,
"updated_at": string,
"updated_by": string | null,
"values": NonNullable<Json>
            }[]
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: false
        isSetofReturn: true
      } },
"log_file_event":
{ Args: { "p_action": string,"p_field": string,"p_file": string,"p_item": string }; Returns: undefined
                           },
"move_item":
{ Args: { "p_automation"?: string,"p_group": string,"p_item": string,"p_position": string }; Returns: {
              "archived_at": string | null,
"created_at": string,
"created_by": string | null,
"display_id": string,
"group_id": string,
"id": string,
"lock_reason": string | null,
"locked": boolean,
"name": string,
"org_id": string,
"position": string,
"seq": number,
"sheet_id": string,
"updated_at": string,
"updated_by": string | null,
"values": NonNullable<Json>
            }
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: true
        isSetofReturn: false
      } },
"non_value_types":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"notify_mention":
{ Args: { "p_update": string,"p_user_ids": (string)[] }; Returns: number
                           },
"pause_pair_ok":
{ Args: { "p_automation": string,"p_item": string,"p_org": string }; Returns: boolean
                           },
"record_automation_run":
{ Args: { "p_automation": string,"p_chain": string,"p_depth": number,"p_detail": string,"p_event": Json,"p_item": string,"p_started_at": string,"p_status": string,"p_steps": Json }; Returns: number
                           },
"record_webhook_attempt":
{ Args: { "p_error": string,"p_id": string,"p_next_attempt_at": string,"p_status": string }; Returns: {
              "attempts": number,
"automation_id": string | null,
"created_at": string,
"id": string,
"item_id": string | null,
"last_error": string | null,
"next_attempt_at": string,
"org_id": string,
"payload": NonNullable<Json>,
"status": string,
"url": string
            }
                          SetofOptions: {
        from: "*"
        to: "outbound_webhooks"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_automation_pause":
{ Args: { "p_automation": string,"p_item": string,"p_paused": boolean }; Returns: boolean
                           },
"set_item_archived":
{ Args: { "p_archived": boolean,"p_item": string }; Returns: {
              "archived_at": string | null,
"created_at": string,
"created_by": string | null,
"display_id": string,
"group_id": string,
"id": string,
"lock_reason": string | null,
"locked": boolean,
"name": string,
"org_id": string,
"position": string,
"seq": number,
"sheet_id": string,
"updated_at": string,
"updated_by": string | null,
"values": NonNullable<Json>
            }
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_item_links":
{ Args: { "p_automation"?: string,"p_field": string,"p_from": string,"p_mode": string,"p_to": (string)[] }; Returns: {
              "created_at": string,
"field_id": string,
"from_item": string,
"id": string,
"org_id": string,
"position": string,
"to_item": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "item_links"
        isOneToOne: false
        isSetofReturn: true
      } },
"set_item_lock":
{ Args: { "p_automation"?: string,"p_item": string,"p_locked": boolean,"p_reason"?: string }; Returns: {
              "archived_at": string | null,
"created_at": string,
"created_by": string | null,
"display_id": string,
"group_id": string,
"id": string,
"lock_reason": string | null,
"locked": boolean,
"name": string,
"org_id": string,
"position": string,
"seq": number,
"sheet_id": string,
"updated_at": string,
"updated_by": string | null,
"values": NonNullable<Json>
            }
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_item_values":
{ Args: { "p_automation"?: string,"p_item": string,"p_name"?: string,"p_note"?: string,"p_patch": Json }; Returns: {
              "archived_at": string | null,
"created_at": string,
"created_by": string | null,
"display_id": string,
"group_id": string,
"id": string,
"lock_reason": string | null,
"locked": boolean,
"name": string,
"org_id": string,
"position": string,
"seq": number,
"sheet_id": string,
"updated_at": string,
"updated_by": string | null,
"values": NonNullable<Json>
            }
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_protected_value":
{ Args: { "p_field": string,"p_item": string,"p_note"?: string,"p_value": string }; Returns: undefined
                           },
"sheet_in_org":
{ Args: { "p_org": string,"p_sheet": string }; Returns: boolean
                           },
"submit_form":
{ Args: { "p_name": string,"p_position": string,"p_token": string,"p_values": Json }; Returns: {
              "archived_at": string | null,
"created_at": string,
"created_by": string | null,
"display_id": string,
"group_id": string,
"id": string,
"lock_reason": string | null,
"locked": boolean,
"name": string,
"org_id": string,
"position": string,
"seq": number,
"sheet_id": string,
"updated_at": string,
"updated_by": string | null,
"values": NonNullable<Json>
            }
                          SetofOptions: {
        from: "*"
        to: "items"
        isOneToOne: true
        isSetofReturn: false
      } },
"submit_public_form":
{ Args: { "p_honeypot": string,"p_ip_hash": string,"p_name": string,"p_position": string,"p_token": string,"p_values": Json }; Returns: Json
                           },
"verify_activity_chain":
{ Args: { "p_chain_key": string }; Returns: Json
                           },
"workspace_slug_available":
{ Args: { "p_slug": string }; Returns: boolean
                           }
          }
          Enums: {
            "member_role": "owner"|"admin"|"editor"|"viewer"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "member_role": ["owner", "admin", "editor", "viewer"]
          }
        }
} as const
