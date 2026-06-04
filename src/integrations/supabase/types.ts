export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      leaderboard_cache: {
        Row: {
          exact_count: number
          goalscorer_points: number
          knockout_points: number
          match_points: number
          onextwo_count: number
          predictions_made: number
          top3_points: number
          top3_submitted_at: string | null
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          exact_count?: number
          goalscorer_points?: number
          knockout_points?: number
          match_points?: number
          onextwo_count?: number
          predictions_made?: number
          top3_points?: number
          top3_submitted_at?: string | null
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          exact_count?: number
          goalscorer_points?: number
          knockout_points?: number
          match_points?: number
          onextwo_count?: number
          predictions_made?: number
          top3_points?: number
          top3_submitted_at?: string | null
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_goalscorers: {
        Row: {
          id: string
          is_first: boolean
          match_id: string
          ord: number
          player_id: string
        }
        Insert: {
          id?: string
          is_first?: boolean
          match_id: string
          ord?: number
          player_id: string
        }
        Update: {
          id?: string
          is_first?: boolean
          match_id?: string
          ord?: number
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_goalscorers_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_goalscorers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          away_score: number | null
          away_source_code: string | null
          away_team_id: string | null
          bracket_code: string | null
          created_at: string
          finished_at: string | null
          group_letter: string | null
          home_score: number | null
          home_source_code: string | null
          home_team_id: string | null
          id: string
          kickoff_at: string
          stage: Database["public"]["Enums"]["match_stage"]
          status: Database["public"]["Enums"]["match_status"]
          winner_team_id: string | null
        }
        Insert: {
          away_score?: number | null
          away_source_code?: string | null
          away_team_id?: string | null
          bracket_code?: string | null
          created_at?: string
          finished_at?: string | null
          group_letter?: string | null
          home_score?: number | null
          home_source_code?: string | null
          home_team_id?: string | null
          id?: string
          kickoff_at: string
          stage: Database["public"]["Enums"]["match_stage"]
          status?: Database["public"]["Enums"]["match_status"]
          winner_team_id?: string | null
        }
        Update: {
          away_score?: number | null
          away_source_code?: string | null
          away_team_id?: string | null
          bracket_code?: string | null
          created_at?: string
          finished_at?: string | null
          group_letter?: string | null
          home_score?: number | null
          home_source_code?: string | null
          home_team_id?: string | null
          id?: string
          kickoff_at?: string
          stage?: Database["public"]["Enums"]["match_stage"]
          status?: Database["public"]["Enums"]["match_status"]
          winner_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          id: string
          name: string
          position: string | null
          team_id: string
        }
        Insert: {
          id?: string
          name: string
          position?: string | null
          team_id: string
        }
        Update: {
          id?: string
          name?: string
          position?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_scorers: {
        Row: {
          id: string
          player_id: string
          prediction_id: string
        }
        Insert: {
          id?: string
          player_id: string
          prediction_id: string
        }
        Update: {
          id?: string
          player_id?: string
          prediction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prediction_scorers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_scorers_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          away_score: number
          first_scorer_player_id: string | null
          home_score: number
          id: string
          match_id: string
          outcome: string
          points: number
          submitted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          away_score: number
          first_scorer_player_id?: string | null
          home_score: number
          id?: string
          match_id: string
          outcome: string
          points?: number
          submitted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          away_score?: number
          first_scorer_player_id?: string | null
          home_score?: number
          id?: string
          match_id?: string
          outcome?: string
          points?: number
          submitted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_first_scorer_player_id_fkey"
            columns: ["first_scorer_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          id: string
          name: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          id: string
          name: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          code: string
          flag_emoji: string | null
          group_letter: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          flag_emoji?: string | null
          group_letter?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          flag_emoji?: string | null
          group_letter?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      top3_predictions: {
        Row: {
          points: number
          runner_up_team_id: string
          submitted_at: string
          third_team_id: string
          updated_at: string
          user_id: string
          winner_team_id: string
        }
        Insert: {
          points?: number
          runner_up_team_id: string
          submitted_at?: string
          third_team_id: string
          updated_at?: string
          user_id: string
          winner_team_id: string
        }
        Update: {
          points?: number
          runner_up_team_id?: string
          submitted_at?: string
          third_team_id?: string
          updated_at?: string
          user_id?: string
          winner_team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "top3_predictions_runner_up_team_id_fkey"
            columns: ["runner_up_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "top3_predictions_third_team_id_fkey"
            columns: ["third_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "top3_predictions_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      match_stage: "group" | "r32" | "r16" | "qf" | "sf" | "third" | "final"
      match_status: "scheduled" | "live" | "finished"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "user"],
      match_stage: ["group", "r32", "r16", "qf", "sf", "third", "final"],
      match_status: ["scheduled", "live", "finished"],
    },
  },
} as const
