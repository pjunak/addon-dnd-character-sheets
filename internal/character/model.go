// Package character coordinates authenticated current character state.
// All rules belong to the selected engine; this package owns persistence only.
package character

import (
	"encoding/json"
	"fmt"
	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
	"strconv"
	"time"
)

const Contract = "dnd5e.character"
const Version = "4.0.0"
const SchemaVersion = "6.2.0"

var reference = workerrpc.AddonDataReference{Kind: workerrpc.AddonDataRecordExtension, DataID: "dnd-sheets"}

type RulesContext struct {
	EngineID         string         `json:"engineId"`
	EngineVersion    string         `json:"engineVersion"`
	EngineGeneration string         `json:"engineGeneration"`
	Identity         map[string]any `json:"identity"`
}
type Projection struct {
	Sheet        model.Sheet                  `json:"sheet"`
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
	// upgraded marks a sheet read from an older stored format; its
	// projection is recomputed from the saved inputs.
	upgraded bool
}
type Request struct {
	ContractVersion   string             `json:"contractVersion"`
	Key               string             `json:"key"`
	ExpectedRevision  int64              `json:"expectedRevision,omitempty"`
	Operation         string             `json:"operation,omitempty"`
	OperationID       string             `json:"operationId,omitempty"`
	Inputs            *model.Inputs      `json:"inputs,omitempty"`
	Change            *model.PlayCommand `json:"change,omitempty"`
	Grant             *model.Grant       `json:"grant,omitempty"`
	GrantID           string             `json:"grantId,omitempty"`
	Token             string             `json:"token,omitempty"`
	AdoptRules        bool               `json:"adoptRules,omitempty"`
	ReauthorizeGrants bool               `json:"reauthorizeGrants,omitempty"`
}
type Response struct {
	ContractVersion string `json:"contractVersion"`
	Status          string `json:"status"`
	Message         string `json:"message"`
	// MessageText is Message with its catalog key when it has one.
	MessageText  *MessageText   `json:"messageText,omitempty"`
	Key          string         `json:"key"`
	Revision     int64          `json:"revision"`
	ActorID      string         `json:"actorId"`
	Role         string         `json:"role"`
	State        *State         `json:"state,omitempty"`
	Evaluation   *model.Result  `json:"evaluation,omitempty"`
	Policy       map[string]any `json:"policy,omitempty"`
	Changes      []Difference   `json:"changes,omitempty"`
	Token        string         `json:"token,omitempty"`
	ExpiresAt    string         `json:"expiresAt,omitempty"`
	RulesChanged bool           `json:"rulesChanged"`
	// Withdrawn lists the saved selections this change removed because the
	// rules no longer allow them.
	Withdrawn []Difference `json:"withdrawn,omitempty"`
}

// MessageText is a message with its key in a message catalog, which the
// browser shows in the reader's language with i18n.message: a key of this
// add-on's catalog, or of the rules engine's catalog when Addon names it.
// Args fill the key's {0}-style placeholders; Text is already filled.
type MessageText struct {
	Text  string            `json:"text"`
	Key   string            `json:"key"`
	Args  map[string]string `json:"args,omitempty"`
	Addon string            `json:"addon,omitempty"`
}

// say sets the message from a template of this add-on's catalog.
func (response *Response) say(template string, args ...any) {
	text := model.NewText(template, args...)
	response.Message = text.Label
	response.MessageText = &MessageText{Text: text.Label, Key: template, Args: map[string]string{}}
	for index, value := range text.LabelArgs {
		response.MessageText.Args[strconv.Itoa(index)] = value
	}
	if len(response.MessageText.Args) == 0 {
		response.MessageText.Args = nil
	}
}

// refused sets the message to a play change the rules engine refused. Its
// wording is keyed in that engine's catalog, which engineID names.
func (response *Response) refused(failure *workerrpc.RPCError, engineID string) {
	response.Message = failure.Message
	var details struct {
		IssueKey  string         `json:"issueKey"`
		IssueArgs map[string]any `json:"issueArgs"`
	}
	if engineID == "" || failure.Data == nil || json.Unmarshal(failure.Data.Details, &details) != nil || details.IssueKey == "" {
		return
	}
	args := map[string]string{}
	for name, value := range details.IssueArgs {
		args[name] = fmt.Sprint(value)
	}
	if len(args) == 0 {
		args = nil
	}
	response.MessageText = &MessageText{Text: failure.Message, Key: details.IssueKey, Args: args, Addon: engineID}
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
	Key, ActorID, Role, Generation, OperationID string
	Revision                                    int64
	Expires                                     time.Time
	State                                       State
}

func raw(value any) json.RawMessage { body, _ := json.Marshal(value); return body }
