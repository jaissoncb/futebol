export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      draw_runs: {
        Row: {
          accepted: boolean
          algorithm_version: string
          balance_score: number | null
          created_at: string
          group_id: string
          id: string
          match_id: string
          run_number: number
          seed: string
        }
        Insert: {
          accepted?: boolean
          algorithm_version: string
          balance_score?: number | null
          created_at?: string
          group_id: string
          id?: string
          match_id: string
          run_number: number
          seed: string
        }
        Update: {
          accepted?: boolean
          algorithm_version?: string
          balance_score?: number | null
          created_at?: string
          group_id?: string
          id?: string
          match_id?: string
          run_number?: number
          seed?: string
        }
        Relationships: [
          {
            foreignKeyName: "draw_runs_match_fk"
            columns: ["group_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string
          group_id: string
          role: Database["public"]["Enums"]["group_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          role?: Database["public"]["Enums"]["group_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          role?: Database["public"]["Enums"]["group_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          created_by: string
          default_players_on_court: number
          id: string
          name: string
          sport: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          default_players_on_court?: number
          id?: string
          name: string
          sport?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          default_players_on_court?: number
          id?: string
          name?: string
          sport?: string
          updated_at?: string
        }
        Relationships: []
      }
      match_players: {
        Row: {
          attendance_status: Database["public"]["Enums"]["attendance_status"]
          created_at: string
          group_id: string
          is_goalkeeper_snapshot: boolean
          match_id: string
          player_id: string
          player_name_snapshot: string
          player_nickname_snapshot: string | null
          preferred_position_snapshot:
            | Database["public"]["Enums"]["preferred_position"]
            | null
          skill_rating_snapshot: number
        }
        Insert: {
          attendance_status?: Database["public"]["Enums"]["attendance_status"]
          created_at?: string
          group_id: string
          is_goalkeeper_snapshot: boolean
          match_id: string
          player_id: string
          player_name_snapshot: string
          player_nickname_snapshot?: string | null
          preferred_position_snapshot?:
            | Database["public"]["Enums"]["preferred_position"]
            | null
          skill_rating_snapshot: number
        }
        Update: {
          attendance_status?: Database["public"]["Enums"]["attendance_status"]
          created_at?: string
          group_id?: string
          is_goalkeeper_snapshot?: boolean
          match_id?: string
          player_id?: string
          player_name_snapshot?: string
          player_nickname_snapshot?: string | null
          preferred_position_snapshot?:
            | Database["public"]["Enums"]["preferred_position"]
            | null
          skill_rating_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_players_match_fk"
            columns: ["group_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["group_id", "id"]
          },
          {
            foreignKeyName: "match_players_player_fk"
            columns: ["group_id", "player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          created_by: string | null
          group_id: string
          id: string
          match_date: string
          match_time: string | null
          name: string | null
          players_on_court: number
          status: Database["public"]["Enums"]["match_status"]
          team_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          group_id: string
          id?: string
          match_date: string
          match_time?: string | null
          name?: string | null
          players_on_court?: number
          status?: Database["public"]["Enums"]["match_status"]
          team_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          group_id?: string
          id?: string
          match_date?: string
          match_time?: string | null
          name?: string | null
          players_on_court?: number
          status?: Database["public"]["Enums"]["match_status"]
          team_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          active: boolean
          created_at: string
          group_id: string
          id: string
          is_goalkeeper: boolean
          name: string
          nickname: string | null
          preferred_position:
            | Database["public"]["Enums"]["preferred_position"]
            | null
          skill_rating: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          group_id: string
          id?: string
          is_goalkeeper?: boolean
          name: string
          nickname?: string | null
          preferred_position?:
            | Database["public"]["Enums"]["preferred_position"]
            | null
          skill_rating?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          group_id?: string
          id?: string
          is_goalkeeper?: boolean
          name?: string
          nickname?: string | null
          preferred_position?:
            | Database["public"]["Enums"]["preferred_position"]
            | null
          skill_rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_assignments: {
        Row: {
          assignment_source: Database["public"]["Enums"]["assignment_source"]
          created_at: string
          group_id: string
          id: string
          match_id: string
          player_id: string
          starts_as_reserve: boolean
          team_id: string
          updated_at: string
        }
        Insert: {
          assignment_source?: Database["public"]["Enums"]["assignment_source"]
          created_at?: string
          group_id: string
          id?: string
          match_id: string
          player_id: string
          starts_as_reserve?: boolean
          team_id: string
          updated_at?: string
        }
        Update: {
          assignment_source?: Database["public"]["Enums"]["assignment_source"]
          created_at?: string
          group_id?: string
          id?: string
          match_id?: string
          player_id?: string
          starts_as_reserve?: boolean
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_assignments_participant_fk"
            columns: ["group_id", "match_id", "player_id"]
            isOneToOne: false
            referencedRelation: "match_players"
            referencedColumns: ["group_id", "match_id", "player_id"]
          },
          {
            foreignKeyName: "team_assignments_team_fk"
            columns: ["group_id", "match_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["group_id", "match_id", "id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string | null
          created_at: string
          group_id: string
          id: string
          match_id: string
          name: string
          team_index: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          group_id: string
          id?: string
          match_id: string
          name: string
          team_index: number
        }
        Update: {
          color?: string | null
          created_at?: string
          group_id?: string
          id?: string
          match_id?: string
          name?: string
          team_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "teams_match_fk"
            columns: ["group_id", "match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_group: {
        Args: {
          default_players_on_court?: number
          group_name: string
          sport?: string
        }
        Returns: string
      }
      save_match_draw: {
        Args: { payload: Json; target_match_id: string }
        Returns: string
      }
    }
    Enums: {
      assignment_source: "draw" | "manual"
      attendance_status: "pending" | "present" | "absent"
      group_role: "owner" | "admin" | "member"
      match_status: "draft" | "drawn" | "completed" | "cancelled"
      preferred_position:
        | "goalkeeper"
        | "defense"
        | "midfield"
        | "attack"
        | "any"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      assignment_source: ["draw", "manual"],
      attendance_status: ["pending", "present", "absent"],
      group_role: ["owner", "admin", "member"],
      match_status: ["draft", "drawn", "completed", "cancelled"],
      preferred_position: [
        "goalkeeper",
        "defense",
        "midfield",
        "attack",
        "any",
      ],
    },
  },
} as const
