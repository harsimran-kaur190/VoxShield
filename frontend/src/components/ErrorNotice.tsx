import { Button } from './ui/Button'
import { ErrorState } from './ui/Feedback'

interface Props {
  title: string
  message: string
  onRetry?: () => void
  onDismiss: () => void
  dismissLabel?: string
}

export function ErrorNotice({ title, message, onRetry, onDismiss, dismissLabel = 'Choose another file' }: Props) {
  return (
    <div className="rise">
      <ErrorState title={title} message={message} onRetry={onRetry}>
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </ErrorState>
    </div>
  )
}
