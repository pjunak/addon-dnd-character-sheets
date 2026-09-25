package character

import (
	"context"
	"reflect"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

type lostReplyData struct {
	*memoryData
	lose bool
}

func (data *lostReplyData) Transact(ctx context.Context, meta *workerrpc.Meta, mutations []workerrpc.AddonDataMutation) (workerrpc.AddonDataCommit, error) {
	commit, err := data.memoryData.Transact(ctx, meta, mutations)
	if err == nil && data.lose {
		data.lose = false
		return workerrpc.AddonDataCommit{}, failure(workerrpc.KindUnavailable, "reply lost after durable commit")
	}
	return commit, err
}

func TestCommandRetryAfterLostCommitAndWorkerRestart(t *testing.T) {
	for _, operation := range []string{"build", "play", "grant", "import"} {
		t.Run(operation, func(t *testing.T) {
			c, data, engine, meta := fixture(t)
			meta.Actor.Role = "dm"
			input := model.Blank()
			inspiration := true
			input.Play.Inspiration = &inspiration
			input.Play.Inventory = []model.Item{{ID: "supplies", Name: "Supplies", Quantity: 2, Location: "carried"}}
			input.Play.QuickUse = []string{"supplies"}
			if _, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "initial-character", Summary: "Create", Inputs: &input}); err != nil {
				t.Fatal(err)
			}
			loss := &lostReplyData{memoryData: data}
			c.data = loss
			command := Request{Operation: operation, OperationID: "uncertain-command", ExpectedRevision: data.revision, Summary: "Apply action"}
			method := "save"
			switch operation {
			case "build":
				spent := false
				input.Play.Inspiration = &spent
				command.Inputs = &input
			case "play":
				command.Change = map[string]any{"operation": "damage", "amount": 1}
			case "grant":
				command.Grant = &model.Grant{Name: "Reward", Reason: "Completed quest", Active: true, EffectiveLevel: 1, Condition: "always", Effects: []model.Effect{}, Waivers: []string{}}
			case "import":
				input.Notes = "Reviewed replacement"
				command.Inputs = &input
				preview := review(t, c, meta, command)
				command = Request{Token: preview.Token, OperationID: command.OperationID, ExpectedRevision: preview.Revision}
				method = "commit"
			}
			loss.lose = true
			if _, err := invoke(t, c, meta, method, command); err == nil {
				t.Fatal("fixture did not lose the commit reply")
			}
			saved := raw(data.state)
			if data.writes != 2 || data.state.OperationID != command.OperationID {
				t.Fatal("action was not committed before the lost reply")
			}
			// No preview cache or live rules are needed to recognize a durable
			// acknowledgment. Host read authorization still runs first.
			restarted := New(loss, engine)
			restarted.now = c.now
			engine.unavailable = true
			data.forbidden = true
			if _, err := invoke(t, restarted, meta, method, command); err == nil {
				t.Fatal("retry bypassed host character authorization")
			}
			data.forbidden = false
			ack, err := invoke(t, restarted, meta, method, command)
			if err != nil || ack.Status != "ready" || ack.Revision != 2 || data.writes != 2 || !reflect.DeepEqual(raw(ack.State), saved) {
				t.Fatalf("restart did not acknowledge the exact saved action: %+v %v", ack, err)
			}
			engine.unavailable = false
			newer := data.state.Inputs
			newer.Notes = "Another editor's later input"
			if _, err := invoke(t, restarted, meta, "save", Request{Operation: "build", OperationID: "later-editor-save", Summary: "Later edit", ExpectedRevision: 2, Inputs: &newer}); err != nil {
				t.Fatal(err)
			}
			current := raw(data.state)
			again, err := invoke(t, restarted, meta, method, command)
			if err == nil && again.Status != "conflict" {
				t.Fatalf("old action was accepted against a later revision: %+v", again)
			}
			if data.writes != 3 || !reflect.DeepEqual(raw(data.state), current) {
				t.Fatal("retry overwrote the later edit")
			}
		})
	}
}
