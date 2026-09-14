// Package character coordinates authenticated current character state.
// All rules belong to the selected engine; this package owns persistence only.
package character

import (
	"encoding/json"
	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
	"time"
)

const Contract = "dnd5e.character"
const Version = "2.0.0"
const SchemaVersion = "4.0.0"

var reference = workerrpc.AddonDataReference{Kind: workerrpc.AddonDataRecordExtension, DataID: "dnd-sheets"}

type RulesContext struct {
	EngineID         string         `json:"engineId"`
	EngineVersion    string         `json:"engineVersion"`
	EngineGeneration string         `json:"engineGeneration"`
	Identity         map[string]any `json:"identity"`
}
type Projection struct {
	Sheet        map[string]any               `json:"sheet"`
	Explanations map[string]model.Explanation `json:"explanations"`
	Evidence     []model.Evidence             `json:"evidence"`
	Issues       []model.Issue                `json:"issues"`
}
type State struct {
	SchemaVersion string       `json:"schemaVersion"`
	Inputs        model.Inputs `json:"inputs"`
	Projection    Projection   `json:"projection"`
	Rules         RulesContext `json:"rules"`
	OperationID   string       `json:"operationId"`
}
type Request struct {
	ContractVersion   string         `json:"contractVersion"`
	Key               string         `json:"key"`
	ExpectedRevision  int64          `json:"expectedRevision,omitempty"`
	Operation         string         `json:"operation,omitempty"`
	OperationID       string         `json:"operationId,omitempty"`
	Summary           string         `json:"summary,omitempty"`
	Inputs            *model.Inputs  `json:"inputs,omitempty"`
	Change            map[string]any `json:"change,omitempty"`
	Grant             *model.Grant   `json:"grant,omitempty"`
	GrantID           string         `json:"grantId,omitempty"`
	Token             string         `json:"token,omitempty"`
	AdoptRules        bool           `json:"adoptRules,omitempty"`
	ReauthorizeGrants bool           `json:"reauthorizeGrants,omitempty"`
}
type Response struct {
	ContractVersion string         `json:"contractVersion"`
	Status          string         `json:"status"`
	Message         string         `json:"message"`
	Key             string         `json:"key"`
	Revision        int64          `json:"revision"`
	ActorID         string         `json:"actorId"`
	Role            string         `json:"role"`
	State           *State         `json:"state,omitempty"`
	Evaluation      *model.Result  `json:"evaluation,omitempty"`
	Policy          map[string]any `json:"policy,omitempty"`
	Changes         []Difference   `json:"changes,omitempty"`
	Token           string         `json:"token,omitempty"`
	ExpiresAt       string         `json:"expiresAt,omitempty"`
	RulesChanged    bool           `json:"rulesChanged"`
}
type Difference struct {
	Path   string `json:"path"`
	Before any    `json:"before"`
	After  any    `json:"after"`
}
type evaluated struct {
	ContractVersion string         `json:"contractVersion"`
	Identity        map[string]any `json:"identity"`
	Evaluation      model.Result   `json:"evaluation"`
	Policy          map[string]any `json:"policy"`
}
type preview struct {
	Key, ActorID, Role, Generation, OperationID, Operation, Summary string
	Revision                                                        int64
	Expires                                                         time.Time
	State                                                           State
	Offline                                                         bool
}

func raw(value any) json.RawMessage { body, _ := json.Marshal(value); return body }
